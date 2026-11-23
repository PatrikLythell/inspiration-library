import type { Endpoint, PayloadRequest } from 'payload'

import { byPalette, searchReferences, similarReferences } from './service'

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
    if (Array.isArray(b.colors) && b.colors.length && !b.query && !b.imageUrl) {
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
