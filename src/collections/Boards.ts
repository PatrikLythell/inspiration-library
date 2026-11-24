import type { CollectionConfig, Endpoint } from 'payload'

import { hydrate } from '../search/lib'
import { addToBoard } from '../import/add'

const signedIn = ({ req }: { req: { user?: unknown } }) => Boolean(req.user)

/** POST /api/boards/:id/items {add?: number[], remove?: number[], note?: string} */
const itemsEndpoint: Endpoint = {
  path: '/:id/items',
  method: 'post',
  handler: async (req) => {
    if (!req.user) return Response.json({ error: 'Sign in first' }, { status: 401 })
    const id = Number(req.routeParams?.id)
    const body: any = (await req.json?.().catch(() => ({}))) ?? {}
    const board: any = await req.payload.findByID({ collection: 'boards', id, depth: 0, overrideAccess: true })
    const items: { reference: number; note?: string | null }[] = (board.items ?? []).map((it: any) => ({
      reference: Number(typeof it.reference === 'object' ? it.reference.id : it.reference),
      note: it.note ?? null,
    }))
    const remove = new Set((body.remove ?? []).map(Number))
    if (remove.size) {
      const kept = items.filter((it) => !remove.has(it.reference))
      await req.payload.update({ collection: 'boards', id, data: { items: kept } as any, overrideAccess: true })
    }
    const add = (body.add ?? []).map(Number).filter(Boolean)
    const count = add.length ? await addToBoard(req.payload, id, add, body.note) : items.length - remove.size
    return Response.json({ id, count })
  },
}

/** GET /api/boards/:id/cards — the board's references in board order, in the shared card shape. */
const cardsEndpoint: Endpoint = {
  path: '/:id/cards',
  method: 'get',
  handler: async (req) => {
    if (!req.user) return Response.json({ error: 'Sign in first' }, { status: 401 })
    const board: any = await req.payload.findByID({
      collection: 'boards',
      id: Number(req.routeParams?.id),
      depth: 0,
      overrideAccess: true,
    })
    const items = (board.items ?? []).map((it: any) => ({
      id: Number(typeof it.reference === 'object' ? it.reference.id : it.reference),
      score: 0,
      note: it.note ?? null,
    }))
    const cards = await hydrate(req.payload, items)
    const notes = new Map(items.map((i: any) => [i.id, i.note]))
    return Response.json({
      board: { id: board.id, name: board.name },
      results: cards.map((c) => ({ ...c, note: notes.get(c.id) ?? null })),
      total: cards.length,
    })
  },
}

/** GET /api/boards/overview — every board with its item count and up to 4 cover thumbs, for the sidebar. */
const overviewEndpoint: Endpoint = {
  path: '/overview',
  method: 'get',
  handler: async (req) => {
    if (!req.user) return Response.json({ error: 'Sign in first' }, { status: 401 })
    const { rows } = await (req.payload.db as any).pool.query(`
      SELECT b.id, b.name, b.parent_id AS parent, b.updated_at,
        (SELECT count(*) FROM boards_items i WHERE i._parent_id = b.id)::int AS count,
        (SELECT coalesce(json_agg(t.url), '[]') FROM (
           SELECT coalesce(m.variants_thumb_url, m.url, r.external_image_thumb) AS url
           FROM boards_items i JOIN "references" r ON r.id = i.reference_id
           LEFT JOIN media m ON m.id = r.image_id
           WHERE i._parent_id = b.id ORDER BY i._order DESC LIMIT 4) t) AS covers
      FROM boards b ORDER BY lower(b.name)`)
    return Response.json({ boards: rows })
  },
}

/** Moodboards (Eagle folders): nested, shared with the team, ordered items with a note each. */
export const Boards: CollectionConfig = {
  slug: 'boards',
  versions: false,
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'parent', 'owner', 'updatedAt'] },
  access: { read: signedIn, create: signedIn, update: signedIn, delete: signedIn },
  endpoints: [overviewEndpoint, itemsEndpoint, cardsEndpoint],
  hooks: {
    beforeChange: [
      ({ req, data, operation }) => {
        if (operation === 'create' && req.user && !data.owner) data.owner = req.user.id
        return data
      },
    ],
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'parent', type: 'relationship', relationTo: 'boards', index: true },
    { name: 'description', type: 'textarea' },
    {
      name: 'items',
      type: 'array',
      fields: [
        { name: 'reference', type: 'relationship', relationTo: 'references', required: true },
        { name: 'note', type: 'text' },
      ],
    },
    { name: 'owner', type: 'relationship', relationTo: 'users' },
  ],
}
