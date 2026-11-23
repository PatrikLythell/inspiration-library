import type { Endpoint, PayloadRequest } from 'payload'

import { setVector, syncMediaTags, upsertSidecar } from '../import/sidecar'
import { hydrate } from './lib'
import { byPalette, facets, searchReferences, similarReferences } from './service'

const body = async (req: PayloadRequest): Promise<any> => {
  try {
    return (await req.json?.()) ?? {}
  } catch {
    return {}
  }
}

const guard = (req: PayloadRequest) =>
  req.user ? null : Response.json({ error: 'Sign in first' }, { status: 401 })

/** POST /api/references/search {query?, imageUrl?, colors?, filters?, limit?, offset?} */
export const searchEndpoint: Endpoint = {
  path: '/search',
  method: 'post',
  handler: async (req) => {
    const denied = guard(req)
    if (denied) return denied
    const b = await body(req)
    if (Array.isArray(b.colors) && b.colors.length && !b.imageUrl) {
      return Response.json(await byPalette(req.payload, b))
    }
    return Response.json(await searchReferences(req.payload, b))
  },
}

/** GET /api/references/:id/similar?limit=24 */
export const similarEndpoint: Endpoint = {
  path: '/:id/similar',
  method: 'get',
  handler: async (req) => {
    const denied = guard(req)
    if (denied) return denied
    const id = Number(req.routeParams?.id)
    const limit = Number(new URL(req.url ?? 'http://x').searchParams.get('limit') ?? 24)
    return Response.json(await similarReferences(req.payload, { ids: [id], limit }))
  },
}

/**
 * POST /api/references/import {source, sidecar, image?: base64, filename?, vector?: number[3072]}
 * One reference per request (keeps bodies under the 4.5 MB function limit). Signed-in users only.
 */
export const importEndpoint: Endpoint = {
  path: '/import',
  method: 'post',
  handler: async (req) => {
    const denied = guard(req)
    if (denied) return denied
    const b = await body(req)
    if (!b.source || !b.sidecar?.id) return Response.json({ error: 'source and sidecar.id required' }, { status: 400 })
    const file = b.image
      ? { data: Buffer.from(b.image, 'base64'), name: b.filename ?? `${b.sidecar.id}.jpg`, mimetype: 'image/jpeg' }
      : undefined
    const doc: any = await upsertSidecar(req.payload, { sidecar: b.sidecar, source: b.source, file })
    if (Array.isArray(b.vector) && b.vector.length === 3072) await setVector(req.payload, doc.id, b.vector)
    return Response.json({ id: doc.id, sourceKey: doc.sourceKey, hasImage: Boolean(doc.image) })
  },
}

/** POST /api/references/sync-tags {offset?, limit?} backfills image tags from reference tags, one page at a time. */
export const syncTagsEndpoint: Endpoint = {
  path: '/sync-tags',
  method: 'post',
  handler: async (req) => {
    const denied = guard(req)
    if (denied) return denied
    const b = await body(req)
    const limit = Math.min(Number(b.limit ?? 50), 200)
    const page = Math.floor(Number(b.offset ?? 0) / limit) + 1
    const res = await req.payload.find({
      collection: 'references',
      where: { image: { exists: true } },
      sort: 'id',
      limit,
      page,
      depth: 0,
      overrideAccess: true,
    })
    let tagged = 0
    for (const r of res.docs as any[]) {
      await syncMediaTags(req.payload, Number(r.image), r.tags ?? {})
      tagged++
    }
    return Response.json({ tagged, totalDocs: res.totalDocs, hasNextPage: res.hasNextPage })
  },
}

/** POST /api/references/facets {filters?} */
export const facetsEndpoint: Endpoint = {
  path: '/facets',
  method: 'post',
  handler: async (req) => {
    const denied = guard(req)
    if (denied) return denied
    const b = await body(req)
    return Response.json(await facets(req.payload, { filters: b.filters }))
  },
}

/** POST /api/references/similar {ids: number[], limit?, filters?} = "more like these" */
export const similarSetEndpoint: Endpoint = {
  path: '/similar',
  method: 'post',
  handler: async (req) => {
    const denied = guard(req)
    if (denied) return denied
    const b = await body(req)
    const ids = (b.ids ?? []).map(Number).filter(Boolean).slice(0, 50)
    if (!ids.length) return Response.json({ error: 'ids required' }, { status: 400 })
    return Response.json(await similarReferences(req.payload, { ids, limit: b.limit ?? 48, filters: b.filters }))
  },
}

/** GET /api/references/:id/card — one reference in the shared card shape (deep links). */
export const cardEndpoint: Endpoint = {
  path: '/:id/card',
  method: 'get',
  handler: async (req) => {
    const denied = guard(req)
    if (denied) return denied
    const [c] = await hydrate(req.payload, [{ id: Number(req.routeParams?.id), score: 0 }])
    return c ? Response.json(c) : Response.json({ error: 'not found' }, { status: 404 })
  },
}
