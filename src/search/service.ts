import type { Payload } from 'payload'

import { embed, type Filters, hydrate, nearest, vectorOf } from './lib'
import { type Candidate, hexToLab, paletteSimilarity, styleBlend } from './rank'

/** Generic reference capability. Every surface (library UI, MCP tools, REST) calls these. */

export async function searchReferences(
  payload: Payload,
  args: { query?: string; imageUrl?: string; filters?: Filters; limit?: number; offset?: number },
) {
  const t0 = performance.now()
  const limit = Math.min(args.limit ?? 48, 200)
  if (!args.query && !args.imageUrl) {
    // Browse mode: newest first with filters, no vector needed.
    const { docs, totalDocs } = await payload.find({
      collection: 'references',
      limit,
      page: Math.floor((args.offset ?? 0) / limit) + 1,
      sort: '-createdAt',
      depth: 1,
      overrideAccess: true,
      where: { status: { equals: 'active' } },
    })
    const { card } = await import('./lib')
    return { results: docs.map((d) => ({ score: 0, ...card(d) })), total: totalDocs, timings: { totalMs: performance.now() - t0 } }
  }
  const vector = await embed(args.query ? { text: args.query } : { imageUrl: args.imageUrl })
  const t1 = performance.now()
  const hits = await nearest(payload, vector, { limit, offset: args.offset, filters: args.filters })
  const t2 = performance.now()
  const results = await hydrate(payload, hits)
  const t3 = performance.now()
  return {
    results,
    timings: { embedMs: t1 - t0, vectorMs: t2 - t1, hydrateMs: t3 - t2, totalMs: t3 - t0 },
  }
}

async function candidateRows(payload: Payload, ids: number[]) {
  const { rows } = await (payload.db as any).pool.query(
    `SELECT id, tags, palette, provenance_brand AS brand FROM "references" WHERE id = ANY($1::int[])`,
    [ids],
  )
  return new Map<number, any>(rows.map((r: any) => [Number(r.id), r]))
}

const labOf = (palette: any): number[][] =>
  ((palette ?? []) as any[])
    .slice(0, 6)
    .map((p) => (Array.isArray(p?.lab) ? p.lab : hexToLab(p?.hex ?? p)))
    .filter(Boolean) as number[][]

/** Look-alikes for one or more references (several = "more like these", using the mean vector). */
export async function similarReferences(
  payload: Payload,
  args: { ids: number[]; limit?: number; filters?: Filters; candidates?: number },
) {
  const t0 = performance.now()
  const vectors = (await Promise.all(args.ids.map((id) => vectorOf(payload, id)))).filter(Boolean) as number[][]
  if (!vectors.length) return { results: [], timings: {} }
  const mean = vectors[0].map((_, i) => vectors.reduce((s, v) => s + v[i], 0) / vectors.length)
  const hits = await nearest(payload, mean, {
    limit: args.candidates ?? 1000,
    filters: args.filters,
  })
  const t1 = performance.now()
  const rows = await candidateRows(payload, [...args.ids, ...hits.map((h) => h.id)])
  const seed = rows.get(args.ids[0])
  const query = {
    id: args.ids[0],
    brand: args.ids.length === 1 ? (seed?.brand ?? '') : '',
    tags: seed?.tags ?? {},
    lab: labOf(seed?.palette),
  }
  const exclude = new Set(args.ids)
  const candidates: Candidate[] = hits
    .filter((h) => !exclude.has(h.id))
    .map((h) => {
      const r = rows.get(h.id)
      return { id: h.id, score: h.score, brand: r?.brand ?? '', tags: r?.tags ?? {}, lab: labOf(r?.palette) }
    })
  const ranked = styleBlend(query, candidates, args.limit ?? 24)
  const t2 = performance.now()
  const results = await hydrate(
    payload,
    ranked.map((r) => ({ id: r.id, score: r.embedding })),
  )
  return {
    results,
    timings: { vectorMs: t1 - t0, rerankMs: t2 - t1, totalMs: performance.now() - t0 },
  }
}

/** Rank references by closeness to a set of colours (hex), optionally filtered. */
export async function byPalette(
  payload: Payload,
  args: { colors: string[]; filters?: Filters; limit?: number },
) {
  const target = args.colors.map(hexToLab).filter(Boolean) as number[][]
  const { rows } = await (payload.db as any).pool.query(
    `SELECT id, palette FROM "references" WHERE status = 'active' AND palette IS NOT NULL`,
  )
  const ranked = rows
    .map((r: any) => ({ id: Number(r.id), score: paletteSimilarity(target, labOf(r.palette)) }))
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, args.limit ?? 48)
  return { results: await hydrate(payload, ranked) }
}
