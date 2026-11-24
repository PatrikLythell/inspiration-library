import { defineTool } from '@payloadcms/plugin-mcp'

import { buildBrief, type Brief } from '../moodboard/brief'
import { generateTiles, IMAGE_MODEL, IMAGE_MODELS } from '../moodboard/generate'

/**
 * Harmonized moodboard capability: board -> one shared look -> the look shown across varied
 * applications, brand-free. Two steps so the person can review the look before images are paid for.
 */

const site = () => process.env.NEXT_PUBLIC_SERVER_URL ?? ''
const pageUrl = (id: number | string) => `${site()}/library/moodboard/${id}`

const WORKFLOW = `Workflow: 1) moodboard_brief on a board (cheap, under $0.10) returns the distilled look and the planned applications. 2) Show the brief to the person in a few lines (name, idea, palette, type, the application list) and let them adjust it (pass changes as "brief" to moodboard_generate, or rerun moodboard_brief with a "direction"). 3) moodboard_generate makes one image per application (default model ~$0.14 per image) and returns the moodboard page. To redo single tiles pass "only" with their keys.`

const text = (v: unknown) => ({ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) })

/** Shallow-merges an edited brief over the stored one; applications and palette replace whole. */
function mergeBrief(base: Brief, patch: any): Brief {
  if (!patch || typeof patch !== 'object') return base
  const out: any = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'source') continue
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = { ...out[k], ...v }
    else out[k] = v
  }
  out.applications = (out.applications ?? []).map((a: any, i: number) => ({
    key: a.key || `tile-${i + 1}`,
    title: a.title ?? '',
    category: a.category ?? '',
    scene: a.scene ?? '',
    aspect_ratio: a.aspect_ratio ?? '4:5',
    anchors: Array.isArray(a.anchors) ? a.anchors.map(Number) : [],
  }))
  return out
}

async function thumb(url: string | null) {
  if (!url) return null
  try {
    const abs = url.startsWith('/') ? `${site()}${url}` : url
    const res = await fetch(abs)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 400_000) return null
    return { type: 'image' as const, data: buf.toString('base64'), mimeType: res.headers.get('content-type') ?? 'image/jpeg' }
  } catch {
    return null
  }
}

function summary(mb: any) {
  return {
    moodboard_id: mb.id,
    name: mb.name,
    status: mb.status,
    model: mb.model,
    cost_usd: Number((mb.cost ?? 0).toFixed(3)),
    page_url: pageUrl(mb.id),
    tiles: (mb.tiles ?? []).map((t: any) => ({
      key: t.key,
      title: t.title,
      image: typeof t.image === 'object' && t.image ? (t.image.url?.startsWith('/') ? `${site()}${t.image.url}` : t.image.url) : null,
      error: t.error ?? undefined,
    })),
  }
}

export const moodboardTools = {
  moodboard_brief: defineTool({
    description: `Distil ONE shared look from a board of references (concept, strict palette, type feel with Google Fonts, materials, photography, graphic language, do/don't) and plan a varied set of applications (packaging, poster, signage, screen, photo, merch, pattern and more) that would show that look in use. Brand-free: no logos, names or readable words. Creates a draft moodboard and returns its id and brief. ${WORKFLOW}`,
    annotations: { title: 'Plan a harmonized moodboard' },
    input: {
      type: 'object',
      properties: {
        board_id: { type: 'integer', description: 'The board to read (see boards_list)' },
        count: { type: 'integer', minimum: 4, maximum: 12, default: 9, description: 'How many applications' },
        direction: { type: 'string', description: 'Optional steer, e.g. "warmer, more tactile, for a coffee roaster"' },
        applications: { type: 'array', items: { type: 'string' }, description: 'Optional applications that must be included, e.g. ["coffee bag", "café menu board"]' },
      },
      required: ['board_id'],
    },
  }).handler(async ({ input, req }) => {
    const i = input as any
    const { brief, cost } = await buildBrief(req.payload, { boardId: Number(i.board_id), count: i.count, direction: i.direction, applications: i.applications })
    const mb: any = await req.payload.create({
      collection: 'moodboards',
      data: { name: brief.name, board: brief.source.board_id, status: 'brief', brief, cost, model: IMAGE_MODEL, owner: (req.user as any)?.id } as any,
      overrideAccess: true,
    })
    const n = brief.applications.length
    return {
      content: [
        text({ moodboard_id: mb.id, page_url: pageUrl(mb.id), estimated_image_cost_usd: Number((n * 0.14).toFixed(2)) }),
        text(brief),
        text('Show this look to the person and confirm or adjust before calling moodboard_generate.'),
      ],
    }
  }),

  moodboard_generate: defineTool({
    description: `Generate the images for a planned moodboard: one per application, all in the brief's shared look, using the board's own images as style anchors. Saves them on the moodboard and returns its page (tiles, palette, type specimen, brief). Optionally pass an edited brief (only the fields you change; applications and palette replace the whole list) and "only" to (re)make specific tiles. ${WORKFLOW}`,
    annotations: { title: 'Generate the moodboard' },
    input: {
      type: 'object',
      properties: {
        moodboard_id: { type: 'integer' },
        brief: { type: 'object', description: 'Optional changes to the brief before generating' },
        only: { type: 'array', items: { type: 'string' }, description: 'Application keys to (re)generate; default all' },
        model: { type: 'string', enum: IMAGE_MODELS, description: `Image model; default ${IMAGE_MODEL}` },
        include_images: { type: 'boolean', default: true },
      },
      required: ['moodboard_id'],
    },
  }).handler(async ({ input, req }) => {
    const i = input as any
    const id = Number(i.moodboard_id)
    if (i.brief) {
      const mb: any = await req.payload.findByID({ collection: 'moodboards', id, depth: 0, overrideAccess: true })
      const brief = mergeBrief(mb.brief, i.brief)
      await req.payload.update({ collection: 'moodboards', id, data: { brief, name: brief.name } as any, overrideAccess: true })
    }
    const mb: any = await generateTiles(req.payload, { moodboardId: id, model: i.model, only: i.only })
    const s = summary(mb)
    const content: any[] = [text(s)]
    if (i.include_images !== false) {
      const thumbs = await Promise.all(
        (mb.tiles ?? []).slice(0, 12).map((t: any) => thumb(typeof t.image === 'object' && t.image ? (t.image.variants?.thumb?.url ?? t.image.url) : null)),
      )
      thumbs.forEach((b, k) => b && content.push(text(`Tile ${mb.tiles[k].key}:`), b))
    }
    return { content }
  }),

  moodboard_get: defineTool({
    description: 'Open a moodboard: its brief, tiles and page link. Without moodboard_id, lists recent moodboards.',
    annotations: { readOnlyHint: true, title: 'Open a moodboard' },
    input: { type: 'object', properties: { moodboard_id: { type: 'integer' } } },
  }).handler(async ({ input, req }) => {
    const i = input as any
    if (!i.moodboard_id) {
      const { docs } = await req.payload.find({ collection: 'moodboards', limit: 30, depth: 0, sort: '-updatedAt', overrideAccess: true })
      return { content: [text(docs.map((d: any) => ({ moodboard_id: d.id, name: d.name, status: d.status, board_id: d.board, page_url: pageUrl(d.id) })))] }
    }
    const mb: any = await req.payload.findByID({ collection: 'moodboards', id: Number(i.moodboard_id), depth: 1, overrideAccess: true })
    return { content: [text(summary(mb)), text(mb.brief)] }
  }),
}
