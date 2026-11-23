import 'dotenv/config'
/** Writes top-8 "similar" ids per weighting variant for a fixed set of seeds (for blind judging). */
import fs from 'fs'
import { getPayload } from 'payload'

import config from '../../src/payload.config'
import { similarReferences } from '../../src/search/service'
import { STYLE_KEYS } from '../../src/search/rank'

const NO_COLOUR = STYLE_KEYS.filter((k) => k !== 'colour_character')
const VARIANTS: Record<string, any> = {
  A_current: { weights: { embedding: 0.3, palette: 0.35, style: 0.35 } },
  B_less_colour: { weights: { embedding: 0.4, palette: 0.15, style: 0.45 }, styleKeys: NO_COLOUR },
  C_low_colour: { weights: { embedding: 0.45, palette: 0.1, style: 0.45 }, styleKeys: NO_COLOUR },
  D_subject: { weights: { embedding: 0.4, palette: 0.1, style: 0.35, subject: 0.15 }, styleKeys: NO_COLOUR },
  E_no_colour: { weights: { embedding: 0.5, palette: 0, style: 0.5 }, styleKeys: NO_COLOUR },
}

const payload = await getPayload({ config })
const { rows } = await (payload.db as any).pool.query(
  `SELECT id FROM "references" WHERE embedding IS NOT NULL AND source <> 'upload' ORDER BY md5(id::text || 'seed7') LIMIT ${Number(process.env.N ?? 16)}`,
)
const out: any[] = []
for (const { id } of rows) {
  const v: Record<string, number[]> = {}
  for (const [name, opts] of Object.entries(VARIANTS)) {
    const r = await similarReferences(payload, { ids: [Number(id)], limit: 8, ...opts })
    v[name] = r.results.map((x: any) => x.id)
  }
  out.push({ seed: Number(id), variants: v })
}
fs.writeFileSync(process.env.OUT!, JSON.stringify(out))
console.log('wrote', out.length)
process.exit(0)
