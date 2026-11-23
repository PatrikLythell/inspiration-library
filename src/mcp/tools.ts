import { defineTool } from '@payloadcms/plugin-mcp'
import type { PayloadRequest } from 'payload'

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
        limit: { type: 'integer', minimum: 1, maximum: 48, default: 12 },
        include_images: { type: 'boolean', default: true },
      },
      required: ['ids'],
    },
  }).handler(async ({ input, req }) => {
    const i = input as any
    const { results } = await similarReferences(req.payload, { ids: i.ids, limit: i.limit ?? 12 })
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
}
