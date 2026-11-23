import { defineTool } from '@payloadcms/plugin-mcp'
import type { PayloadRequest } from 'payload'

import { addReference, addToBoard, fetchImage } from '../import/add'
import { hydrate } from '../search/lib'
import { searchReferences, similarReferences, byPalette } from '../search/service'

/**
 * Generic reference capability for any assistant: references.search, .search_by_image,
 * .similar, .by_palette, .get. Tool names use underscores (dots are not allowed in tool
 * names). Descriptions stay vendor-neutral so the backend can be swapped.
 */

const TAG_HELP =
  'Optional filters object. tags/excludeTags map a category (mood, style, medium, subject, composition, colour_character, era_reference, typography_style) to values, e.g. {"tags":{"style":["minimal"]}}.'

const MAX_IMAGES = 8

const site = () => process.env.NEXT_PUBLIC_SERVER_URL ?? ''

const abs = (u?: string | null) => (u && u.startsWith('/') ? `${site()}${u}` : (u ?? null))

async function thumbBlock(url: string | null, auth?: string | null) {
  if (!url) return null
  try {
    // Hosted media is access-controlled: forward the caller's own credentials.
    const own = url.startsWith(site())
    const res = await fetch(url, own && auth ? { headers: { Authorization: auth } } : undefined)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 400_000) return null
    return {
      type: 'image' as const,
      data: buf.toString('base64'),
      mimeType: res.headers.get('content-type') ?? 'image/jpeg',
    }
  } catch {
    return null
  }
}

/** Text list + a few small thumbnails so the assistant can see the references. */
async function respond(results: any[], withImages: boolean, req?: PayloadRequest) {
  const lines = results.map((r) => ({
    id: r.id,
    description: r.description,
    image: abs(r.large ?? r.grid),
    thumb: abs(r.thumb),
    palette: r.palette,
    tags: r.tags,
    credit: r.credit,
    source_url: r.sourceUrl,
    library_url: `${site()}/library?ref=${r.id}`,
  }))
  const content: any[] = [{ type: 'text', text: JSON.stringify(lines, null, 1) }]
  if (withImages) {
    const blocks = await Promise.all(results.slice(0, MAX_IMAGES).map((r) => thumbBlock(abs(r.thumb), req?.headers.get('authorization'))))
    for (const [i, b] of blocks.entries()) {
      if (!b) continue
      content.push({ type: 'text', text: `Image for id ${results[i].id}:` }, b)
    }
  }
  return { content }
}

const filtersSchema = {
  type: 'object',
  description: TAG_HELP,
  properties: {
    tags: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
    excludeTags: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
    sources: { type: 'array', items: { type: 'string' } },
  },
} as const

export const referenceTools = {
  references_search: defineTool({
    description:
      'Search the team visual reference library by describing a look, mood, style or subject in words (any language). Returns references with image URLs, palette, tags and credit, plus small previews. Search by look, not by brand name.',
    annotations: { readOnlyHint: true, title: 'Search references' },
    input: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What it should look like, e.g. "grainy 70s print, warm muted colours"' },
        filters: filtersSchema,
        limit: { type: 'integer', minimum: 1, maximum: 48, default: 12 },
        include_images: { type: 'boolean', default: true },
      },
      required: ['query'],
    },
  }).handler(async ({ input, req }) => {
    const i = input as any
    const { results } = await searchReferences((req as PayloadRequest).payload, {
      query: i.query,
      filters: i.filters,
      limit: i.limit ?? 12,
    })
    return respond(results, i.include_images !== false, req)
  }),

  references_search_by_image: defineTool({
    description:
      'Find references that look like a given image (public https URL). Use for "find more like this picture".',
    annotations: { readOnlyHint: true, title: 'Search references by image' },
    input: {
      type: 'object',
      properties: {
        image_url: { type: 'string' },
        filters: filtersSchema,
        limit: { type: 'integer', minimum: 1, maximum: 48, default: 12 },
        include_images: { type: 'boolean', default: true },
      },
      required: ['image_url'],
    },
  }).handler(async ({ input, req }) => {
    const i = input as any
    const { results } = await searchReferences(req.payload, {
      imageUrl: i.image_url,
      filters: i.filters,
      limit: i.limit ?? 12,
    })
    return respond(results, i.include_images !== false, req)
  }),

  references_similar: defineTool({
    description:
      'References with a similar look (palette, style and composition) to one or more reference ids, from other brands. Several ids = "more like these".',
    annotations: { readOnlyHint: true, title: 'Similar references' },
    input: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'integer' }, minItems: 1 },
        match: {
          type: 'string',
          enum: ['style', 'balanced', 'colour'],
          default: 'style',
          description: 'style = same look and feel, colour matters little (default); balanced; colour = mostly the same colours',
        },
        limit: { type: 'integer', minimum: 1, maximum: 48, default: 12 },
        include_images: { type: 'boolean', default: true },
      },
      required: ['ids'],
    },
  }).handler(async ({ input, req }) => {
    const i = input as any
    const { results } = await similarReferences(req.payload, { ids: i.ids, limit: i.limit ?? 12, mode: i.match })
    return respond(results, i.include_images !== false, req)
  }),

  references_by_palette: defineTool({
    description: 'References whose colour palette is closest to the given hex colours.',
    annotations: { readOnlyHint: true, title: 'References by palette' },
    input: {
      type: 'object',
      properties: {
        colors: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Hex colours, e.g. ["#1e4d3f", "#f2efe6"]' },
        limit: { type: 'integer', minimum: 1, maximum: 48, default: 12 },
        include_images: { type: 'boolean', default: true },
      },
      required: ['colors'],
    },
  }).handler(async ({ input, req }) => {
    const i = input as any
    const { results } = await byPalette(req.payload, { colors: i.colors, limit: i.limit ?? 12 })
    return respond(results, i.include_images !== false, req)
  }),

  references_add: defineTool({
    description:
      'Add an image to the team reference library from a public image URL. It is tagged (mood, style, colour…) and made searchable automatically. If the library already has the same image, that one is returned. Optionally puts it on a board.',
    annotations: { title: 'Add a reference' },
    input: {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: 'Direct link to the image (jpg, png, webp)' },
        source_url: { type: 'string', description: 'Page the image comes from, for credit' },
        credit: { type: 'string', description: 'Who made it, if known' },
        board_id: { type: 'integer', description: 'Board to add it to (see boards_list)' },
      },
      required: ['image_url'],
    },
  }).handler(async ({ input, req }) => {
    const i = input as any
    const out = await addReference(req.payload, {
      data: await fetchImage(i.image_url),
      sourceUrl: i.source_url ?? i.image_url,
      credit: i.credit ?? null,
      board: i.board_id ?? null,
      userId: (req.user as any)?.id,
    })
    const res = await respond([out.reference], true, req)
    res.content.unshift({ type: 'text', text: out.duplicate ? 'Already in the library; returning the existing reference.' : 'Added.' })
    return res
  }),

  boards_list: defineTool({
    description: 'List the team moodboards (id, name, parent board, number of references).',
    annotations: { readOnlyHint: true, title: 'List boards' },
    input: { type: 'object', properties: {} },
  }).handler(async ({ req }) => {
    const { docs } = await req.payload.find({ collection: 'boards', limit: 500, depth: 0, sort: 'name', overrideAccess: true })
    const boards = docs.map((b: any) => ({ id: b.id, name: b.name, parent: b.parent ?? null, count: b.items?.length ?? 0, library_url: `${site()}/library?board=${b.id}` }))
    return { content: [{ type: 'text', text: JSON.stringify(boards, null, 1) }] }
  }),

  boards_get: defineTool({
    description: 'The references on one board, in board order, with previews.',
    annotations: { readOnlyHint: true, title: 'Open a board' },
    input: {
      type: 'object',
      properties: { board_id: { type: 'integer' }, include_images: { type: 'boolean', default: true } },
      required: ['board_id'],
    },
  }).handler(async ({ input, req }) => {
    const i = input as any
    const board: any = await req.payload.findByID({ collection: 'boards', id: i.board_id, depth: 0, overrideAccess: true })
    const ids = (board.items ?? []).map((it: any) => ({ id: Number(typeof it.reference === 'object' ? it.reference.id : it.reference), score: 0 }))
    const cards = await hydrate(req.payload, ids)
    const res = await respond(cards, i.include_images !== false, req)
    res.content.unshift({ type: 'text', text: `Board "${board.name}" (${cards.length} references)` })
    return res
  }),

  boards_add: defineTool({
    description: 'Put references on a board. Give board_id for an existing board, or board_name to create a new one.',
    annotations: { title: 'Add to board' },
    input: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'integer' }, minItems: 1, description: 'Reference ids' },
        board_id: { type: 'integer' },
        board_name: { type: 'string', description: 'Creates a new board with this name' },
        note: { type: 'string', description: 'Why these were picked' },
      },
      required: ['ids'],
    },
  }).handler(async ({ input, req }) => {
    const i = input as any
    let id = i.board_id
    if (!id) {
      if (!i.board_name) return { content: [{ type: 'text', text: 'Give board_id or board_name.' }] }
      const created: any = await req.payload.create({ collection: 'boards', data: { name: i.board_name, owner: (req.user as any)?.id } as any, overrideAccess: true })
      id = created.id
    }
    const count = await addToBoard(req.payload, Number(id), i.ids.map(Number), i.note ?? null)
    return { content: [{ type: 'text', text: JSON.stringify({ board_id: id, count, library_url: `${site()}/library?board=${id}` }) }] }
  }),
}
