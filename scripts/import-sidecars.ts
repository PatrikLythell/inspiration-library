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
import { upsertSidecar } from '../src/import/sidecar'

const DIR = process.env.DIR!
const SOURCE = process.env.SOURCE ?? 'brandarchive'
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 6)

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
        await upsertSidecar(payload, { sidecar: s, source: SOURCE, filePath: path.join(DIR, s.file ?? `${s.id}.jpg`) })
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
