import type { Payload } from 'payload'

import { boardCards, loadImage, openrouter, type Brief } from './brief'

/** Step 2: one image per application, all following the brief's shared look. */

export const IMAGE_MODEL = process.env.MOODBOARD_IMAGE_MODEL ?? 'google/gemini-3-pro-image'
export const IMAGE_MODELS = ['google/gemini-3-pro-image', 'google/gemini-2.5-flash-image', 'google/gemini-3.1-flash-image']
const CONCURRENCY = 6

/** Joins brief phrases without doubled punctuation (".;" or ".."). */
const join = (xs: string[], sep = '; ') => xs.map((x) => x.trim().replace(/[.;,\s]+$/, '')).filter(Boolean).join(sep)

/** How each medium handles copy it does not spell out: layouts keep their structure; photos stay photos. */
const SMALL_COPY: Record<string, string> = {
  'web-ui': 'Smaller interface copy reads as fine grey lines at realistic size, as in a real product shot; never a wireframe.',
  print: 'Smaller copy reads as fine lines.',
  packaging: 'Smaller copy reads as fine lines.',
  graphic: 'Smaller copy reads as fine lines.',
  photography: 'It stays a pure photograph: no overlaid graphics, bars or interface elements.',
  space: 'It stays a pure photograph of the space: no overlaid graphics.',
  object: 'It stays a pure photograph: no overlaid graphics.',
}

export function tilePrompt(brief: Brief, app: Brief['applications'][number], anchors: number) {
  // Colour names, not hex codes: models tend to paint hex codes into the image as labels.
  const pal = brief.palette.map((p) => p.name).join(', ')
  const mood = brief.mood?.length ? brief.mood.join(', ') : ''
  const sameKind = brief.signatures?.find((x) => x.id === app.lead)?.kind === app.kind
  const how: Record<string, string> = {
    'web-ui': 'Copy its interface closely: page layout, grid, proportions of image and blocks, navigation and UI component style, device and how the screen is shot.',
    photography: 'Copy its photography closely: subject treatment, staging, light and shadow, camera angle, crop, grade and grain.',
    packaging: 'Copy its packaging closely: form, construction, surface graphics, finish and how it is shot.',
    print: 'Copy its print closely: format, layout, colour blocking, stock, arrangement and how it is shot.',
    space: 'Copy its space closely: architecture, materials, light, scale and how it is shot.',
    graphic: 'Copy its graphic language closely: shapes, composition, colour handling and texture.',
    object: 'Copy its object treatment closely: form, material, finish and how it is shot.',
  }
  return `Create one image for a brand moodboard.

${anchors ? `THE FIRST ATTACHED IMAGE IS THE LEAD REFERENCE. Make an adapted copy of it: ${sameKind ? how[app.kind] ?? how.graphic : 'the same way of making the image: composition, light, colour intensity, graphic devices, finish.'} Change only the content so it shows the subject below for this business. Keep its boldness and specific details; do not tone it down, tidy it up or make it more generic. Do not copy its product, its marks or any lettering.${anchors > 1 ? ' The second attached image is only for a small harmonising touch (colour or mood); do not let it change the lead\'s character.' : ''}\n\n` : ''}SHOW: ${app.title}. ${app.scene}
${app.devices?.length ? `COPY THESE DETAILS FROM THE LEAD: ${join(app.devices)}.\n` : ''}
FOR: ${brief.context || 'a brand'}.
LIGHT HARMONY ONLY (lean slightly toward these; the lead's character wins): palette ${pal}${mood ? `; mood ${mood}` : ''}.

${app.headline ? `TYPOGRAPHY: set the words "${app.headline}" (spelled exactly like this, nothing added) as the display type, in the lead's own type style: same weight, scale, case, tightness and placement.${brief.voice ? ` The typesetting should match this voice: ${brief.voice}` : ''} This is the only readable text.` : 'No readable text.'} ${SMALL_COPY[app.kind] ?? SMALL_COPY.photography} Never logos, brand names, trademarks or colour codes. Objects are made of what such objects are really made of. A single image, no borders, no collage.`
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
  const wanted = [...new Set(apps.flatMap((a) => [a.lead, ...a.anchors].filter(Boolean)))]
  const anchorData = new Map<number, string>()
  await Promise.all(
    wanted.map(async (id) => {
      const c: any = byId.get(id)
      const img = c && (await loadImage(c.large ?? c.grid ?? c.thumb, 1024))
      if (img) anchorData.set(id, img)
    }),
  )

  let spent = 0
  const results = await pool(apps, CONCURRENCY, async (app) => {
    const anchors = [app.lead, ...app.anchors].map((id) => anchorData.get(id)).filter(Boolean) as string[]
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
