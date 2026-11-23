import type { Payload } from 'payload'

import { normalise, toLiteral } from '../search/lib'
import { hexToLab } from '../search/rank'

const TAG_KEYS = [
  'mood',
  'style',
  'medium',
  'subject',
  'composition',
  'colour_character',
  'era_reference',
  'typography_style',
  'keywords',
]

/** Maps one scrape-recipe sidecar to a references document. */
export function toDoc(s: any, source: string) {
  const vt = s.visual_tags ?? {}
  const prov = s.provenance ?? {}
  const tags = Object.fromEntries(TAG_KEYS.map((k) => [k, vt[k] ?? []]))
  const palette = (vt.palette ?? []).map((hex: string, i: number) => ({
    hex,
    name: vt.palette_names?.[i] ?? null,
    lab: hexToLab(hex),
  }))
  const linked = !s.file && s.remote
  return {
    sourceKey: `${source}:${s.id}`,
    source,
    storage: linked ? 'linked' : 'hosted',
    status: 'active',
    description: vt.description ?? '',
    tags,
    palette,
    dominantColor: s.dominant_color ?? null,
    externalImage: linked
      ? {
          thumb: s.remote.thumb,
          small: s.remote.small,
          large: s.remote.large,
          original: s.remote.original,
          width: s.remote.width,
          height: s.remote.height,
        }
      : undefined,
    provenance: {
      brand: prov.brand ?? null,
      year: prov.year ?? null,
      designers: prov.designers ?? [],
      sourceUrl: prov.source_url ?? null,
      articleUrl: prov.article_url ?? null,
      credit: [prov.brand, ...(prov.designers ?? [])].filter(Boolean).join(' · '),
    },
  }
}

/** Upserts one reference by sourceKey. Uploads the image only when the reference has none yet. */
export async function upsertSidecar(
  payload: Payload,
  args: { sidecar: any; source: string; file?: { data: Buffer; name: string; mimetype: string }; filePath?: string },
) {
  const data: any = toDoc(args.sidecar, args.source)
  const existing = await payload.find({
    collection: 'references',
    where: { sourceKey: { equals: data.sourceKey } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const prev = existing.docs[0] as any
  if (data.storage === 'hosted' && !prev?.image && (args.file || args.filePath)) {
    const media: any = await payload.create({
      collection: 'media',
      data: { alt: data.description?.slice(0, 200) ?? '' },
      ...(args.file ? { file: { ...args.file, size: args.file.data.length } } : { filePath: args.filePath }),
      overrideAccess: true,
    })
    data.image = media.id
    data.width = media.width
    data.height = media.height
  }
  const doc: any = prev
    ? await payload.update({ collection: 'references', id: prev.id, data, overrideAccess: true })
    : await payload.create({ collection: 'references', data, overrideAccess: true })
  const mediaId = typeof doc.image === 'object' ? doc.image?.id : doc.image
  if (mediaId) await syncMediaTags(payload, Number(mediaId), data.tags)
  return doc
}

/** Stores the full image vector and its truncated 1536 variant. */
export async function setVector(payload: Payload, id: number | string, vector: number[]) {
  const full = normalise(vector)
  const short = normalise(full.slice(0, 1536))
  await (payload.db as any).pool.query(
    `UPDATE "references" SET embedding = $1::halfvec(3072), embedding_1536 = $2::halfvec(1536) WHERE id = $3`,
    [toLiteral(full), toLiteral(short), id],
  )
}

/** Tag categories mirrored into the hierarchical Tags collection (keywords stay search-only: too many and too noisy). */
const TAG_CATEGORIES: Record<string, string> = {
  mood: 'Mood',
  style: 'Style',
  medium: 'Medium',
  subject: 'Subject',
  composition: 'Composition',
  colour_character: 'Colour',
  era_reference: 'Era',
  typography_style: 'Typography',
}

const tagCache = new Map<string, number>()

async function findOrCreateTag(payload: Payload, name: string, parent: number | null): Promise<number> {
  const key = `${parent ?? 'root'}/${name.toLowerCase()}`
  const hit = tagCache.get(key)
  if (hit) return hit
  const { docs } = await payload.find({
    collection: 'tags',
    where: {
      and: [
        { name: { equals: name } },
        parent ? { _h_tags: { equals: parent } } : { _h_tags: { exists: false } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const id = Number(
    docs[0]?.id ??
      (await payload.create({ collection: 'tags', data: { name, _h_tags: parent } as any, overrideAccess: true })).id,
  )
  tagCache.set(key, id)
  return id
}

/** Puts a reference's sidecar tags on its image as Category > value tags, so the asset views show them. */
export async function syncMediaTags(payload: Payload, mediaId: number, tags: Record<string, string[]>) {
  const ids: number[] = []
  for (const [cat, label] of Object.entries(TAG_CATEGORIES)) {
    const values = [...new Set((tags?.[cat] ?? []).map((v) => String(v).trim().toLowerCase()).filter(Boolean))]
    if (!values.length) continue
    const parent = await findOrCreateTag(payload, label, null)
    for (const v of values) ids.push(await findOrCreateTag(payload, v, parent))
  }
  await payload.update({ collection: 'media', id: mediaId, data: { _h_tags: ids } as any, overrideAccess: true })
  return ids.length
}
