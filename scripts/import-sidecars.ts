import 'dotenv/config'
/**
 * Import references from a folder of <id>.jpg + <id>.json sidecars (scrape-recipe format).
 * Idempotent: upserts on sourceKey, skips images already uploaded.
 *
 *   SOURCE=brandarchive DIR=/path/to/folder pnpm payload run scripts/import-sidecars.ts
 *
 * Linked sources (no image files): sidecars with "file": null and a "remote" block are stored
 * as storage=linked with externalImage URLs.
 */
import fs from 'fs'
import path from 'path'
import { getPayload } from 'payload'

import config from '../src/payload.config'
import { hexToLab } from '../src/search/rank'

const DIR = process.env.DIR!
const SOURCE = process.env.SOURCE ?? 'brandarchive'
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 6)

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

function toDoc(s: any) {
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
    sourceKey: `${SOURCE}:${s.id}`,
    source: SOURCE,
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

async function main() {
  const payload = await getPayload({ config })
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
  console.log(`importing ${files.length} sidecars from ${DIR} as ${SOURCE}`)
  let done = 0
  let failed = 0
  const queue = [...files]
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift()!
      try {
        const s = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
        const data: any = toDoc(s)
        const existing = await payload.find({
          collection: 'references',
          where: { sourceKey: { equals: data.sourceKey } },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        })
        const prev = existing.docs[0] as any
        if (data.storage === 'hosted' && !prev?.image) {
          const filePath = path.join(DIR, s.file ?? `${s.id}.jpg`)
          const media = await payload.create({
            collection: 'media',
            data: { alt: data.description?.slice(0, 200) ?? '' },
            filePath,
            overrideAccess: true,
          })
          data.image = media.id
          data.width = (media as any).width
          data.height = (media as any).height
        }
        if (prev) {
          await payload.update({ collection: 'references', id: prev.id, data, overrideAccess: true })
        } else {
          await payload.create({ collection: 'references', data, overrideAccess: true })
        }
        done++
        if (done % 50 === 0) console.log(`  ${done}/${files.length}`)
      } catch (e) {
        failed++
        console.error(`  failed ${f}:`, (e as Error).message)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  console.log(`done: ${done} imported, ${failed} failed`)
  process.exit(0)
}

main()
