import { createHash } from 'crypto'
import type { Payload } from 'payload'
import sharp from 'sharp'

import { embed, hydrate, nearest } from '../search/lib'
import { setVector, upsertSidecar } from './sidecar'
import { tagImage, toTagImage } from './tagger'

/** Above this cosine similarity an added image counts as already in the library (same cutoff as the scrapes). */
export const DUPLICATE_AT = 0.96
const MAX_BYTES = 15_000_000

/** Fetches a public image URL (http/https only) for adding. */
export async function fetchImage(url: string): Promise<Buffer> {
  const u = new URL(url)
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http(s) image links')
  const res = await fetch(u, { headers: { Accept: 'image/*' }, redirect: 'follow' })
  if (!res.ok) throw new Error(`Could not fetch the image (${res.status})`)
  const type = res.headers.get('content-type') ?? ''
  if (!type.startsWith('image/')) throw new Error('That link is not an image')
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_BYTES) throw new Error('Image is larger than 15 MB')
  return buf
}

/**
 * Adds one image to the library: auto-tags it (scrape-recipe model and vocabulary), embeds it,
 * stores it as a hosted reference with source "upload", and optionally puts it on a board.
 * A near-identical image already in the library is returned instead of a new copy.
 */
export async function addReference(
  payload: Payload,
  args: {
    data: Buffer
    filename?: string
    sourceUrl?: string | null
    credit?: string | null
    context?: string | null
    board?: number | null
    userId?: number | string | null
    force?: boolean
  },
) {
  // Normalise to a web-friendly original (max 3000 px) so very large files stay storable.
  const meta = await sharp(args.data).metadata()
  if (!meta.width || !meta.height) throw new Error('Not a readable image')
  const original = await sharp(args.data)
    .rotate()
    .resize(3000, 3000, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 88 })
    .toBuffer()
  const hash = createHash('sha1').update(original).digest('hex').slice(0, 16)
  const small = await toTagImage(original)

  const [tags, vector] = await Promise.all([tagImage(small, args.context ?? undefined), embed({ imageUrl: small })])

  if (!args.force) {
    const [hit] = await nearest(payload, vector, { limit: 1 })
    if (hit && hit.score >= DUPLICATE_AT) {
      const [card] = await hydrate(payload, [hit])
      if (args.board) await addToBoard(payload, args.board, [hit.id])
      return { duplicate: true, reference: card }
    }
  }

  const sidecar = {
    id: hash,
    visual_tags: tags,
    provenance: {
      brand: args.credit ?? null,
      source_url: args.sourceUrl ?? null,
      designers: [],
    },
  }
  const base = (args.filename ?? 'reference').replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9-_]+/gi, '-').slice(0, 60) || 'reference'
  const doc: any = await upsertSidecar(payload, {
    sidecar,
    source: 'upload',
    file: { data: original, name: `${base}-${hash}.jpg`, mimetype: 'image/jpeg' },
  })
  await setVector(payload, doc.id, vector)
  if (args.userId) {
    await payload.update({ collection: 'references', id: doc.id, data: { addedBy: args.userId } as any, overrideAccess: true }).catch(() => undefined)
  }
  if (args.board) await addToBoard(payload, args.board, [Number(doc.id)])
  const [card] = await hydrate(payload, [{ id: Number(doc.id), score: 1 }])
  return { duplicate: false, reference: card }
}

/** Appends references to a board, skipping ones already on it. */
export async function addToBoard(payload: Payload, boardId: number, ids: number[], note?: string | null) {
  const board: any = await payload.findByID({ collection: 'boards', id: boardId, depth: 0, overrideAccess: true })
  const items = (board.items ?? []).map((it: any) => ({
    reference: Number(typeof it.reference === 'object' ? it.reference.id : it.reference),
    note: it.note ?? null,
  }))
  const have = new Set(items.map((i: any) => i.reference))
  for (const id of ids) if (!have.has(id)) items.push({ reference: id, note: note ?? null }), have.add(id)
  await payload.update({ collection: 'boards', id: boardId, data: { items } as any, overrideAccess: true })
  return items.length
}
