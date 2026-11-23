import type { Payload } from 'payload'

/** Embedding model used for every stored image vector; text and image queries must use the same one. */
export const EMBED_MODEL = 'google/gemini-embedding-2'
export const FULL_DIMS = 3072

/** Which stored vector column search uses: 'embedding' (3072) or 'embedding_1536' (truncated, re-normalised). */
export const dims = (): 1536 | 3072 => (process.env.EMBED_DIMS === '1536' ? 1536 : 3072)
const column = (d: number) => (d === 1536 ? 'embedding_1536' : 'embedding')

export type Filters = {
  /** include: every listed category must match at least one value, e.g. {style: ['minimal'], mood: ['calm']} */
  tags?: Record<string, string[]>
  /** exclude: drop references having any of these values */
  excludeTags?: Record<string, string[]>
  sources?: string[]
  /** each value must appear in some tag category (from #tag in the search bar) */
  anyTags?: string[]
}

export type Hit = { id: number; score: number }

const TAG_KEYS = new Set([
  'mood',
  'style',
  'medium',
  'subject',
  'composition',
  'colour_character',
  'era_reference',
  'typography_style',
  'keywords',
])

export const normalise = (v: number[]): number[] => {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
  return v.map((x) => x / n)
}

/** Truncate a full vector to the active dimension count (Matryoshka) and re-normalise. */
export const fit = (v: number[]): number[] => normalise(v.slice(0, dims()))

export const toLiteral = (v: number[]) => `[${v.map((x) => x.toFixed(6)).join(',')}]`

/** Embed a text query or an image (data: URL or https URL) with the library's model. */
export async function embed(input: { text?: string; imageUrl?: string }): Promise<number[]> {
  const body = {
    model: EMBED_MODEL,
    input: input.text
      ? [input.text]
      : [{ content: [{ type: 'image_url', image_url: { url: input.imageUrl } }] }],
  }
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? 'proxy'}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`embedding failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { data: { embedding: number[] }[] }
  return normalise(json.data[0].embedding)
}

/** Builds the WHERE clause for filters; params are appended to `params`. */
export function whereClause(f: Filters, params: unknown[]): string {
  const parts = [`r.status = 'active'`]
  for (const [cat, values] of Object.entries(f.tags ?? {})) {
    if (!TAG_KEYS.has(cat) || !values?.length) continue
    params.push(values)
    parts.push(`(r.tags -> '${cat}') ?| $${params.length}::text[]`)
  }
  for (const [cat, values] of Object.entries(f.excludeTags ?? {})) {
    if (!TAG_KEYS.has(cat) || !values?.length) continue
    params.push(values)
    parts.push(`NOT coalesce((r.tags -> '${cat}') ?| $${params.length}::text[], false)`)
  }
  for (const v of f.anyTags ?? []) {
    if (!v) continue
    params.push([v, v.toLowerCase()])
    parts.push(`EXISTS (SELECT 1 FROM jsonb_each(r.tags) e WHERE jsonb_typeof(e.value) = 'array' AND e.value ?| $${params.length}::text[])`)
  }
  if (f.sources?.length) {
    params.push(f.sources)
    parts.push(`r.source::text = ANY($${params.length}::text[])`)
  }
  return parts.join(' AND ')
}

/** Nearest neighbours by cosine distance on the HNSW index, with SQL filters. */
export async function nearest(
  payload: Payload,
  vector: number[],
  opts: { limit: number; offset?: number; filters?: Filters; excludeIds?: number[] },
): Promise<Hit[]> {
  const d = dims()
  const col = column(d)
  const params: unknown[] = [toLiteral(fit(vector))]
  let where = whereClause(opts.filters ?? {}, params)
  if (opts.excludeIds?.length) {
    params.push(opts.excludeIds)
    where += ` AND NOT (r.id = ANY($${params.length}::int[]))`
  }
  params.push(opts.limit, opts.offset ?? 0)
  const sql = `SELECT r.id, 1 - (r.${col} <=> $1::halfvec(${d})) AS score
    FROM "references" r
    WHERE r.${col} IS NOT NULL AND ${where}
    ORDER BY r.${col} <=> $1::halfvec(${d})
    LIMIT $${params.length - 1} OFFSET $${params.length}`
  const client = await (payload.db as any).pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL hnsw.ef_search = ${Math.min(1000, Math.max(100, opts.limit))}`)
    await client.query(`SET LOCAL hnsw.iterative_scan = relaxed_order`).catch(() => undefined)
    const { rows } = await client.query(sql, params)
    await client.query('COMMIT')
    return rows.map((r: any) => ({ id: Number(r.id), score: Number(r.score) }))
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw e
  } finally {
    client.release()
  }
}

/** The stored full vector for one reference. */
export async function vectorOf(payload: Payload, id: number): Promise<number[] | null> {
  const { rows } = await (payload.db as any).pool.query(
    `SELECT embedding::text AS v FROM "references" WHERE id = $1`,
    [id],
  )
  if (!rows[0]?.v) return null
  return JSON.parse(rows[0].v) as number[]
}

/** Loads full documents for hits, keeping the ranked order. */
export async function hydrate(payload: Payload, hits: Hit[]) {
  if (!hits.length) return []
  const { docs } = await payload.find({
    collection: 'references',
    where: { id: { in: hits.map((h) => h.id) } },
    limit: hits.length,
    depth: 1,
    overrideAccess: true,
  })
  const byId = new Map(docs.map((d) => [Number(d.id), d]))
  return hits.flatMap((h) => {
    const doc = byId.get(h.id)
    return doc ? [{ score: h.score, ...card(doc) }] : []
  })
}

/** The compact shape every surface (UI, MCP, API) uses for one reference. */
export function card(doc: any) {
  const media = typeof doc.image === 'object' ? doc.image : null
  const hosted = (size: string) => media?.variants?.[size]?.url ?? media?.url ?? null
  return {
    id: Number(doc.id),
    sourceKey: doc.sourceKey,
    source: doc.source,
    description: doc.description ?? '',
    thumb: doc.storage === 'linked' ? doc.externalImage?.thumb : hosted('thumb'),
    grid: doc.storage === 'linked' ? (doc.externalImage?.small ?? doc.externalImage?.thumb) : hosted('grid'),
    large: doc.storage === 'linked' ? doc.externalImage?.large : hosted('large'),
    width: doc.width ?? media?.width ?? null,
    height: doc.height ?? media?.height ?? null,
    palette: (doc.palette ?? []).map((p: any) => p.hex),
    tags: doc.tags ?? {},
    credit: doc.provenance?.credit ?? doc.provenance?.brand ?? '',
    brand: doc.provenance?.brand ?? '',
    sourceUrl: doc.provenance?.articleUrl ?? doc.provenance?.sourceUrl ?? null,
  }
}
