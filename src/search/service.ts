import type { Payload } from 'payload'

import { embed, type Filters, hydrate, nearest, vectorOf, whereClause } from './lib'
import { type Candidate, type Weights, SIMILAR_MODES, hexToLab, paletteSimilarity, similarMode, styleBlend } from './rank'

/** Generic reference capability. Every surface (library UI, MCP tools, REST) calls these. */

export async function searchReferences(
  payload: Payload,
  args: { query?: string; imageUrl?: string; filters?: Filters; limit?: number; offset?: number },
) {
  const t0 = performance.now()
  const limit = Math.min(args.limit ?? 48, 200)
  if (!args.query && !args.imageUrl) {
    // Browse mode: newest first with filters, no vector needed.
    const params: unknown[] = []
    const where = whereClause(args.filters ?? {}, params)
    const pool = (payload.db as any).pool
    const [{ rows }, { rows: count }] = await Promise.all([
      pool.query(
        `SELECT r.id FROM "references" r WHERE ${where} ORDER BY r.id DESC LIMIT ${limit} OFFSET ${Math.max(0, Number(args.offset ?? 0))}`,
        params,
      ),
      pool.query(`SELECT count(*)::int AS n FROM "references" r WHERE ${where}`, params),
    ])
    const results = await hydrate(payload, rows.map((r: any) => ({ id: Number(r.id), score: 0 })))
    return { results, total: count[0].n, timings: { totalMs: performance.now() - t0 } }
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
  args: { ids: number[]; limit?: number; filters?: Filters; candidates?: number; mode?: string; weights?: Weights; styleKeys?: readonly string[] },
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
  const preset = SIMILAR_MODES[similarMode(args.mode)]
  const ranked = styleBlend(query, candidates, args.limit ?? 24, 2, args.weights ?? preset.weights, args.styleKeys ?? preset.styleKeys)
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
  args: { colors: string[]; filters?: Filters; limit?: number; offset?: number; query?: string },
) {
  const t0 = performance.now()
  const target = args.colors.map(hexToLab).filter(Boolean) as number[][]
  const limit = Math.min(args.limit ?? 48, 200)
  const offset = Math.max(0, Number(args.offset ?? 0))
  let pool: { id: number; palette: any; qrank?: number }[]
  if (args.query) {
    // Words + colour: the 400 best matches for the words, re-ranked by colour (rank fusion).
    const hits = await nearest(payload, await embed({ text: args.query }), { limit: 400, filters: args.filters })
    const rows = await candidateRows(payload, hits.map((h) => h.id))
    pool = hits.map((h, i) => ({ id: h.id, palette: rows.get(h.id)?.palette, qrank: i }))
  } else {
    const params: unknown[] = []
    const where = whereClause(args.filters ?? {}, params)
    const { rows } = await (payload.db as any).pool.query(
      `SELECT r.id, r.palette FROM "references" r WHERE ${where} AND r.palette IS NOT NULL`,
      params,
    )
    pool = rows.map((r: any) => ({ id: Number(r.id), palette: r.palette }))
  }
  const scored = pool.map((r) => ({ ...r, score: paletteSimilarity(target, labOf(r.palette)) }))
  const byColour = [...scored].sort((a, b) => b.score - a.score)
  let ranked = byColour
  if (args.query) {
    const crank = new Map(byColour.map((r, i) => [r.id, i]))
    const fused = (r: { id: number; qrank?: number }) => 1 / (60 + (r.qrank ?? 0)) + 1 / (60 + (crank.get(r.id) ?? 0))
    ranked = [...scored].sort((a, b) => fused(b) - fused(a))
  }
  const page = ranked.slice(offset, offset + limit).map((r) => ({ id: r.id, score: r.score }))
  return { results: await hydrate(payload, page), total: ranked.length, timings: { totalMs: performance.now() - t0 } }
}

const FACET_KEYS = ['mood', 'style', 'medium', 'subject', 'era_reference', 'typography_style', 'colour_character', 'composition']

/** Counts per tag value (top 40 per category) and per source, over the filtered set. */
export async function facets(payload: Payload, args: { filters?: Filters }) {
  const params: unknown[] = []
  const where = whereClause(args.filters ?? {}, params)
  const n = params.length
  const pool = (payload.db as any).pool
  const [{ rows }, { rows: src }] = await Promise.all([
    pool.query(
      `SELECT k.key AS cat, v.val, count(*)::int AS n
         FROM "references" r, jsonb_each(r.tags) k, jsonb_array_elements_text(k.value) v(val)
        WHERE ${where} AND k.key = ANY($${n + 1}::text[]) AND jsonb_typeof(k.value) = 'array'
        GROUP BY 1, 2`,
      [...params, FACET_KEYS],
    ),
    pool.query(
      `SELECT r.source::text AS val, count(*)::int AS n FROM "references" r WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`,
      params,
    ),
  ])
  const out: Record<string, { value: string; count: number }[]> = {}
  for (const k of FACET_KEYS) {
    out[k] = rows
      .filter((r: any) => r.cat === k && !['none', 'n/a', 'unknown'].includes(String(r.val).toLowerCase()))
      .sort((a: any, b: any) => b.n - a.n)
      .slice(0, 40)
      .map((r: any) => ({ value: r.val, count: r.n }))
  }
  out.source = src.map((r: any) => ({ value: r.val, count: r.n }))
  return out
}
