import type { Payload } from 'payload'
import sharp from 'sharp'

import { hydrate } from '../search/lib'

/**
 * Step 1 of a harmonized moodboard: read a board and distil ONE shared look from it
 * (concept, palette, type feel, materials, photography, graphic language) plus a varied set of
 * applications that show that look in use. Brand-free: no logos, names or readable words.
 */

export const BRIEF_MODEL = process.env.MOODBOARD_BRIEF_MODEL ?? 'google/gemini-3.5-flash'
const BRIEF_FALLBACK = 'google/gemini-3-flash-preview'
const MAX_LOOK = 14

/** The range the applications are drawn from. The model picks the ones that suit the look. */
export const APPLICATION_MENU = [
  'packaging (box, bottle, bag, label, tin)',
  'poster or print campaign',
  'outdoor signage or wayfinding',
  'shopfront, interior or environment',
  'website or app screen on a device',
  'social post or story',
  'lifestyle or product photography',
  'stationery, business card or printed matter',
  'merchandise or apparel (tote, tee, cap)',
  'pattern, texture or material swatch',
  'editorial spread or book',
  'event, exhibition or pop-up',
  'vehicle, uniform or fleet',
  'motion still or campaign key visual',
]

export type Brief = {
  name: string
  idea: string
  mood: string[]
  palette: { hex: string; name: string; role: string; share: number }[]
  typography: { feel: string; display: string; text: string; treatment: string }
  materials: string[]
  photography: { light: string; lens: string; grade: string; subjects: string }
  graphic_language: { shapes: string; pattern: string; layout: string; composition: string }
  do: string[]
  dont: string[]
  style_prompt: string
  applications: { key: string; title: string; category: string; scene: string; aspect_ratio: string; anchors: number[] }[]
  source: { board_id: number; board_name: string; reference_ids: number[] }
}

const PROMPT = (n: number, board: string, direction?: string, wanted?: string[]) => `You are a senior brand designer building a harmonized moodboard.
Below are references from a moodboard called "${board}" (each image is labelled with its id, tags and palette).
The references are mixed: different brands, media and colours. Your job is to find the ONE coherent look
they share (or the strongest look they point to) and define it so tightly that every new image made from it
looks like the same brand world. Pick, do not average: drop references and colours that pull away from the look.
${direction ? `Steer from the designer: ${direction}\n` : ''}
Rules:
- No logos, brand names, trademarks or recognisable products from the references. This is a look, not a copy.
- Image models write gibberish, so applications carry NO letters at all: labels, signs, screens, covers and pages show
  blank space, colour fields, abstract shapes, rules or texture instead. Never mention text, type, lettering, words or
  numbers in a scene. The type feel lives only in the typography field.
- The palette is strict: 4-6 colours with roles (base, surface, ink, accent, support) and share in percent summing to 100.
- typography.display and typography.text are real Google Fonts families that match the type feel.
- style_prompt: one dense paragraph (60-110 words) an image model can follow for EVERY tile: medium, light,
  grade, grain, materials, colour use by colour NAME (no hex codes), shapes and composition habits. No brand names, no text.
- applications: exactly ${n}, as varied as possible across categories and scales (close-up, object, space,
  screen, print, photo, pattern), each showing the look in real use. ${wanted?.length ? `Must include: ${wanted.join('; ')}.` : `Choose from: ${APPLICATION_MENU.join('; ')}.`}
  scene: 1-3 sentences describing exactly what is in frame, camera/angle and how palette, type feel and graphic language appear.
  aspect_ratio: one of 1:1, 4:5, 3:4, 2:3, 16:9, 3:2 (mix them for a lively board).
  anchors: 1-3 reference ids whose look this tile should borrow most.
Return JSON only:
{"name": short evocative name for the look (2-4 words),
 "idea": one sentence: the idea behind the look,
 "mood": 5 words,
 "palette": [{"hex":"#rrggbb","name":"","role":"","share":0}],
 "typography": {"feel":"","display":"","text":"","treatment":""},
 "materials": 4-6 materials, finishes or textures,
 "photography": {"light":"","lens":"","grade":"","subjects":""},
 "graphic_language": {"shapes":"","pattern":"","layout":"","composition":""},
 "do": 4 rules, "dont": 4 rules,
 "style_prompt": "",
 "applications": [{"key":"kebab-case","title":"","category":"","scene":"","aspect_ratio":"","anchors":[id]}]}`

/** Fetches an image (absolute URL or a site-relative media path) and shrinks it for the model. */
export async function loadImage(url: string | null | undefined, maxSide = 640): Promise<string | null> {
  if (!url) return null
  try {
    const abs = url.startsWith('/') ? `${process.env.NEXT_PUBLIC_SERVER_URL ?? ''}${url}` : url
    const res = await fetch(abs, { headers: { Accept: 'image/*' } })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const jpg = await sharp(buf).rotate().resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer()
    return `data:image/jpeg;base64,${jpg.toString('base64')}`
  } catch {
    return null
  }
}

/** The board's references as cards, in board order. */
export async function boardCards(payload: Payload, boardId: number) {
  const board: any = await payload.findByID({ collection: 'boards', id: boardId, depth: 0, overrideAccess: true })
  const ids = (board.items ?? []).map((it: any) => ({ id: Number(typeof it.reference === 'object' ? it.reference.id : it.reference), score: 0 }))
  return { board, cards: await hydrate(payload, ids) }
}

export async function openrouter(body: any) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? 'proxy'}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, usage: { include: true } }),
  })
  if (!res.ok) throw new Error(`${body.model}: ${res.status} ${(await res.text()).slice(0, 300)}`)
  return (await res.json()) as any
}

const parseJson = (s: string) => JSON.parse(s.trim().replace(/^```(json)?/, '').replace(/```$/, '').trim())

export async function buildBrief(
  payload: Payload,
  args: { boardId: number; count?: number; direction?: string; applications?: string[] },
): Promise<{ brief: Brief; cost: number }> {
  const { board, cards } = await boardCards(payload, args.boardId)
  if (cards.length < 2) throw new Error('The board needs at least 2 references.')
  const n = Math.min(Math.max(args.count ?? 9, 4), 12)
  const look = cards.slice(0, MAX_LOOK)
  const images = await Promise.all(look.map((c: any) => loadImage(c.grid ?? c.thumb)))

  const content: any[] = [{ type: 'text', text: PROMPT(n, board.name, args.direction, args.applications) }]
  look.forEach((c: any, i: number) => {
    const t = c.tags ?? {}
    const meta = { id: c.id, description: c.description?.slice(0, 200), mood: t.mood, style: t.style, medium: t.medium, typography: t.typography_style, palette: c.palette }
    content.push({ type: 'text', text: `Reference ${JSON.stringify(meta)}` })
    if (images[i]) content.push({ type: 'image_url', image_url: { url: images[i] } })
  })
  // Board members beyond the ones shown still count through their tags.
  if (cards.length > look.length) {
    const rest = cards.slice(look.length).map((c: any) => ({ id: c.id, mood: c.tags?.mood, style: c.tags?.style, palette: c.palette }))
    content.push({ type: 'text', text: `More references on the board (no image): ${JSON.stringify(rest)}` })
  }

  let json: any
  for (const model of [BRIEF_MODEL, BRIEF_FALLBACK]) {
    try {
      json = await openrouter({ model, temperature: 0.5, response_format: { type: 'json_object' }, messages: [{ role: 'user', content }] })
      const brief = parseJson(String(json.choices?.[0]?.message?.content ?? ''))
      return { brief: clean(brief, board, cards), cost: Number(json.usage?.cost ?? 0) }
    } catch (e) {
      if (model === BRIEF_FALLBACK) throw e
    }
  }
  throw new Error('unreachable')
}

const RATIOS = new Set(['1:1', '4:5', '3:4', '2:3', '16:9', '3:2', '9:16', '5:4', '4:3'])

/** Normalises the model's brief so later steps can trust its shape. */
export function clean(b: any, board: any, cards: any[]): Brief {
  const ids = new Set(cards.map((c) => c.id))
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(/\s*[,;]\s*/).filter(Boolean) : [])
  const palette = (Array.isArray(b.palette) ? b.palette : [])
    .filter((p: any) => /^#[0-9a-f]{6}$/i.test(str(p?.hex)))
    .slice(0, 6)
    .map((p: any) => ({ hex: p.hex.toLowerCase(), name: str(p.name), role: str(p.role), share: Number(p.share) || 0 }))
  if (!palette.length) throw new Error('brief has no palette')
  const apps = (Array.isArray(b.applications) ? b.applications : []).map((a: any, i: number) => ({
    key: str(a.key) || `tile-${i + 1}`,
    title: str(a.title) || `Application ${i + 1}`,
    category: str(a.category),
    scene: str(a.scene),
    aspect_ratio: RATIOS.has(str(a.aspect_ratio)) ? a.aspect_ratio : '4:5',
    anchors: list(a.anchors).map(Number).filter((id) => ids.has(id)).slice(0, 3),
  }))
  if (!apps.length) throw new Error('brief has no applications')
  return {
    name: str(b.name) || `${board.name} look`,
    idea: str(b.idea),
    mood: list(b.mood).slice(0, 6),
    palette,
    typography: { feel: str(b.typography?.feel), display: str(b.typography?.display), text: str(b.typography?.text), treatment: str(b.typography?.treatment) },
    materials: list(b.materials).slice(0, 8),
    photography: { light: str(b.photography?.light), lens: str(b.photography?.lens), grade: str(b.photography?.grade), subjects: str(b.photography?.subjects) },
    graphic_language: {
      shapes: str(b.graphic_language?.shapes),
      pattern: str(b.graphic_language?.pattern),
      layout: str(b.graphic_language?.layout),
      composition: str(b.graphic_language?.composition),
    },
    do: list(b.do).slice(0, 6),
    dont: list(b.dont).slice(0, 6),
    style_prompt: str(b.style_prompt),
    applications: apps,
    source: { board_id: Number(board.id), board_name: board.name, reference_ids: cards.map((c) => c.id) },
  }
}
