import type { Payload } from 'payload'

import { boardCards, loadImage, openrouter, type Brief } from './brief'

/** Step 2: one image per application, all following the brief's shared look. */

export const IMAGE_MODEL = process.env.MOODBOARD_IMAGE_MODEL ?? 'google/gemini-3-pro-image'
export const IMAGE_MODELS = ['google/gemini-3-pro-image', 'google/gemini-2.5-flash-image', 'google/gemini-3.1-flash-image']
const CONCURRENCY = 6

export function tilePrompt(brief: Brief, app: Brief['applications'][number], anchors: number) {
  // Colour names, not hex codes: models tend to paint hex codes into the image as labels.
  const pal = brief.palette.map((p) => `${p.name} (${p.role}, about ${p.share}%)`).join(', ')
  const style = brief.style_prompt.replace(/\s*\(?#[0-9a-f]{6}\)?/gi, '')
  return `Create one photograph-quality image for a brand moodboard.

SHOW: ${app.title}. ${app.scene}

SHARED LOOK "${brief.name}": ${brief.idea}
${style}
Palette, use only these colours: ${pal}.
Materials: ${brief.materials.join(', ')}.
Photography: ${brief.photography.light}; ${brief.photography.lens}; ${brief.photography.grade}.
Graphic language: ${brief.graphic_language.shapes}; ${brief.graphic_language.pattern}; ${brief.graphic_language.composition}.
Avoid: ${brief.dont.join('; ')}.

${anchors ? `The attached ${anchors > 1 ? 'images are style anchors' : 'image is a style anchor'}: borrow light, grade, texture and colour handling only. Do not copy their content, layout, products or any marks.\n` : ''}STRICT: absolutely no text, letters, numbers, logos, brand names, trademarks, colour codes or swatch labels anywhere. Labels, signs, screens, covers and pages carry only blank space, colour fields, simple abstract shapes, fine rules or texture. Real, imperfect, crafted, natural textures and light; not glossy CGI. No borders, no collage, a single image.`
}

async function generateOne(model: string, prompt: string, ratio: string, anchorImages: string[]) {
  const content: any[] = [{ type: 'text', text: prompt }, ...anchorImages.map((url) => ({ type: 'image_url', image_url: { url } }))]
  const json = await openrouter({
    model,
    modalities: ['image', 'text'],
    image_config: { aspect_ratio: ratio },
    messages: [{ role: 'user', content }],
  })
  const url: string | undefined = json.choices?.[0]?.message?.images?.[0]?.image_url?.url
  if (!url?.startsWith('data:image/')) throw new Error('no image returned')
  const [head, b64] = url.split(',')
  return { data: Buffer.from(b64, 'base64'), mimetype: head.slice(5).split(';')[0], cost: Number(json.usage?.cost ?? 0) }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i], i)
      }
    }),
  )
  return out
}

/**
 * Generates the tiles for a moodboard (all, or only the given keys, e.g. to redo one) and stores
 * them on it. Returns the updated moodboard doc.
 */
export async function generateTiles(payload: Payload, args: { moodboardId: number; model?: string; only?: string[] }) {
  const mb: any = await payload.findByID({ collection: 'moodboards', id: args.moodboardId, depth: 0, overrideAccess: true })
  const brief: Brief = mb.brief
  const model = args.model ?? mb.model ?? IMAGE_MODEL
  const apps = brief.applications.filter((a) => !args.only?.length || args.only.includes(a.key))
  if (!apps.length) throw new Error('No matching applications in the brief.')

  await payload.update({ collection: 'moodboards', id: mb.id, data: { status: 'generating', model } as any, overrideAccess: true })

  // Anchor images: shrink each referenced board image once.
  const { cards } = await boardCards(payload, brief.source.board_id).catch(() => ({ cards: [] as any[] }))
  const byId = new Map(cards.map((c: any) => [c.id, c]))
  const wanted = [...new Set(apps.flatMap((a) => a.anchors))]
  const anchorData = new Map<number, string>()
  await Promise.all(
    wanted.map(async (id) => {
      const c: any = byId.get(id)
      const img = c && (await loadImage(c.grid ?? c.thumb, 768))
      if (img) anchorData.set(id, img)
    }),
  )

  let spent = 0
  const results = await pool(apps, CONCURRENCY, async (app) => {
    const anchors = app.anchors.map((id) => anchorData.get(id)).filter(Boolean) as string[]
    const prompt = tilePrompt(brief, app, anchors.length)
    let lastError = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const img = await generateOne(model, prompt, app.aspect_ratio, anchors)
        spent += img.cost
        const ext = img.mimetype.includes('png') ? 'png' : img.mimetype.includes('webp') ? 'webp' : 'jpg'
        const media: any = await payload.create({
          collection: 'media',
          data: { alt: `${brief.name}: ${app.title}` },
          file: { data: img.data, name: `moodboard-${mb.id}-${app.key}-${Date.now()}.${ext}`, mimetype: img.mimetype, size: img.data.length },
          overrideAccess: true,
        })
        return { key: app.key, title: app.title, prompt, image: media.id, error: null }
      } catch (e: any) {
        lastError = String(e?.message ?? e).slice(0, 300)
      }
    }
    return { key: app.key, title: app.title, prompt, image: null, error: lastError }
  })

  // Merge: replace redone tiles, keep the rest, follow the brief's order.
  const fresh = await payload.findByID({ collection: 'moodboards', id: mb.id, depth: 0, overrideAccess: true })
  const prev = new Map(((fresh as any).tiles ?? []).map((t: any) => [t.key, t]))
  for (const r of results) {
    const old: any = prev.get(r.key)
    if (r.image || !old?.image) prev.set(r.key, r)
  }
  const tiles = brief.applications
    .map((a) => prev.get(a.key))
    .filter(Boolean)
    .map((t: any) => ({ key: t.key, title: t.title, prompt: t.prompt, image: typeof t.image === 'object' && t.image ? t.image.id : t.image, error: t.error ?? null }))
  const ok = tiles.filter((t) => t.image).length
  return payload.update({
    collection: 'moodboards',
    id: mb.id,
    data: { tiles, status: ok ? 'done' : 'failed', cost: Number(((fresh as any).cost ?? 0) + spent) } as any,
    overrideAccess: true,
    depth: 1,
  })
}
