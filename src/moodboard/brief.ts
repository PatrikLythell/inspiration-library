import type { Payload } from 'payload'
import sharp from 'sharp'

import { hydrate } from '../search/lib'

/**
 * Step 1 of a harmonized moodboard: read a board and distil ONE shared look from it
 * (concept, palette, materials, photography, graphic language; used internally to keep images consistent) plus a varied set of
 * applications that show that look in use. Brand-free: no logos or brand names; display type keeps the references' style with short neutral headline words.
 */

export const BRIEF_MODEL = process.env.MOODBOARD_BRIEF_MODEL ?? 'google/gemini-3.5-flash'
const BRIEF_FALLBACK = 'google/gemini-3-flash-preview'
const MAX_LOOK = 14

/** Kinds of touchpoint, as inspiration only: the model derives the real list from the context. */
export const TOUCHPOINT_KINDS = [
  'product (physical product, packaging, or a product screen)',
  'digital (website, app, social, email, ad)',
  'print (poster, editorial, stationery, report)',
  'space (shop, office, venue, signage, wayfinding)',
  'events (booth, pop-up, exhibition, launch)',
  'people (uniform, merch, apparel)',
  'photography (lifestyle, portrait, still life)',
  'look study (material, texture, pattern, light; no object)',
]

/** Media kinds: a reference only leads tiles of its own kind, so web stays web and photo stays photo. */
export const MEDIA_KINDS = ['photography', 'web-ui', 'packaging', 'print', 'space', 'graphic', 'object'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

export type Breadth = 'focused' | 'balanced' | 'wide'

/** Share of core / stretch / look-builder applications per breadth setting. */
const MIX: Record<Breadth, [number, number]> = {
  focused: [0.7, 0.2],
  balanced: [0.5, 0.35],
  wide: [0.35, 0.45],
}

export function tierCounts(n: number, breadth: Breadth = 'balanced') {
  const [c, s] = MIX[breadth] ?? MIX.balanced
  const core = Math.max(1, Math.round(n * c))
  const stretch = Math.max(1, Math.round(n * s))
  return { core, stretch, look: Math.max(1, n - core - stretch) }
}

export type Application = {
  key: string
  title: string
  category: string
  tier: 'core' | 'stretch' | 'look'
  why: string
  scene: string
  aspect_ratio: string
  /** What medium this tile is; its lead is a reference of the same kind whenever the board has one. */
  kind: MediaKind
  /** The reference this tile is a close cousin of; sent first as the image anchor. */
  lead: number
  /** Signature devices from the references this tile carries literally. */
  devices: string[]
  /** Short neutral display words set in the lead's type style ('' for tiles without typography). */
  headline: string
  anchors: number[]
}

export type Brief = {
  name: string
  idea: string
  context: string
  context_inferred: boolean
  breadth: Breadth
  mood: string[]
  /** How the direction talks, read from the concept: it sets the tone of every headline. */
  voice: string
  palette: { hex: string; name: string; role: string; share: number }[]
  materials: string[]
  photography: { light: string; lens: string; grade: string; subjects: string }
  graphic_language: { shapes: string; pattern: string; layout: string; composition: string }
  do: string[]
  dont: string[]
  style_prompt: string
  /** Per reference: the concrete visual devices that make it what it is. */
  signatures: { id: number; kind: MediaKind; devices: string[] }[]
  applications: Application[]
  source: { board_id: number; board_name: string; reference_ids: number[] }
}

type PromptArgs = { n: number; board: string; context?: string; breadth: Breadth; direction?: string; wanted?: string[] }

const PROMPT = ({ n, board, context, breadth, direction, wanted }: PromptArgs) => {
  const t = tierCounts(n, breadth)
  return `You are a senior brand designer building a moodboard for a new brand direction.
Below are references from a moodboard called "${board}" (each image is labelled with its id, tags and palette).
The designer picked each reference for a job, by its medium: a photo for how the photography should look, a website
for how the web should look, packaging for packaging, and so on. Respect that split:
- Each new image is a close, adapted copy of ONE reference OF THE SAME MEDIUM (its lead): same layout, structure,
  composition, crop, light, finish and graphic devices, with only the content changed to this business.
  A web or app tile copies a web/ui reference's layout and interface style closely; a photography tile copies a
  photo reference's subject treatment, light and framing closely; packaging follows packaging; and so on.
- Only a small conciliation between the media holds the board together: a shared palette and vibe. It must never
  override the lead's own character. Never average the references into something safe, minimal or generic.

WHO IT IS FOR: ${context ? context : 'not given. Infer the most likely kind of business or organisation from the board, state it in "context" and set "context_inferred": true.'}
The applications are the touchpoints this kind of business really has.
${direction ? `Steer from the designer: ${direction}
` : ''}
Rules:
- No logos, brand names, trademarks or recognisable products from the references.
- Typography is part of the style: where a lead reference gets its punch from type, the tile keeps that type style
  (weight, size, case, tightness, layout). Image models only spell short display text reliably, so each such tile gets
  a "headline": 1-4 short words that fit this business, never a brand name, a logo or a real company.
- voice: read the concept and write how this direction talks, then write EVERY headline in that voice. The copy's
  energy matches the visuals: a big, bold concept gets big, bold copy ("Numbers, handled."); a calm concept gets calm,
  witty copy ("Quietly on top of it"); a professional concept gets sleek, confident copy ("Clarity, by design").
  Headlines across the board should feel written by one person. Small body copy is left to the image model as fine lines; do not
  describe it. Photography and space tiles normally have headline "" unless signage or a poster is the point.
- signatures: for EVERY reference, its kind (one of: ${MEDIA_KINDS.join(', ')}; what the reference IS an example of,
  e.g. a laptop showing a website is web-ui, a staged shadow photo is photography, a box is packaging) and 2-4 concrete devices someone would recognise it by (e.g. "human silhouette shadow
  falling across a translucent coloured panel", "hard midday cast shadow of a cut-out shape on grey asphalt",
  "objects shot from directly above, scattered in a dense grid of saturated flat colours", "bold saturated green
  object against a sunlit white wall, harsh flash"). Specific and visual, never abstract adjectives.
- palette: 4-6 colours with roles and share in percent summing to 100, taken from the references at their REAL
  saturation (do not mute them).
- style_prompt: one dense paragraph (60-110 words) on the shared vibe: light, grade, grain, colour use by colour NAME
  (no hex codes). It harmonises; it must not flatten the references' devices.
- applications: exactly ${n}, in three tiers (breadth: ${breadth}):
  * ${t.core} "core": touchpoints this business certainly uses and that matter most to it.
  * ${t.stretch} "stretch": plausible for this business but less expected, to show the look travels.
  * ${t.look} "look": a study of the world itself (light, material, pattern, a photographic moment), no product.
  Spread them across kinds and scales (close-up, object, space, screen, print, photo); no two of the same kind unless the business lives there.
  Kinds to think across: ${TOUCHPOINT_KINDS.join('; ')}.${wanted?.length ? `\n  Must include (count them as core): ${wanted.join('; ')}.` : ''}
  Plan from the board: the media on the board decide which kinds of touchpoint get tiles. Every reference leads at
  least one tile (if there are more references than tiles, pick the strongest).
  kind: the tile's medium, one of: ${MEDIA_KINDS.join(', ')}.
  lead: the ONE reference id this tile is an adapted copy of. It MUST have the same kind as the tile; only if the
  board has no reference of that kind, use the closest one.
  devices: 2-3 details from the lead that this tile copies literally. At most one small harmonising touch may come
  from another reference (usually just colour).
  scene: 2-3 sentences: exactly what is in frame, camera and crop, and HOW the devices appear in it. Make it as
  specific and bold as the lead reference.
  Sense check: objects are made of what such objects are really made of (a business card is card, a laptop is aluminium).
  why: one short sentence on why this touchpoint matters for this business.
  aspect_ratio: one of 1:1, 4:5, 3:4, 2:3, 16:9, 3:2 (mix them for a lively board; follow the lead's framing where it fits).
  anchors: 0-1 further reference id for the harmonising touch (not the lead); usually none.
Return JSON only:
{"name": short evocative name for the direction (2-4 words),
 "idea": one sentence: the idea behind the direction, for this business,
 "context": who it is for, one line, "context_inferred": true|false,
 "mood": 5 words,
 "voice": one sentence on the tone of voice and why it fits the concept,
 "palette": [{"hex":"#rrggbb","name":"","role":"","share":0}],
 "materials": 4-6 materials, finishes or textures,
 "photography": {"light":"","lens":"","grade":"","subjects":""},
 "graphic_language": {"shapes":"","pattern":"","layout":"","composition":""},
 "do": 4 rules, "dont": 4 rules,
 "style_prompt": "",
 "signatures": [{"id":0,"kind":"","devices":[""]}],
 "applications": [{"key":"kebab-case","title":"","category":"","tier":"core|stretch|look","why":"","kind":"","lead":0,"devices":[""],"headline":"","scene":"","aspect_ratio":"","anchors":[id]}]}`
}

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
  args: { boardId: number; count?: number; context?: string; breadth?: Breadth; direction?: string; applications?: string[] },
): Promise<{ brief: Brief; cost: number }> {
  const { board, cards } = await boardCards(payload, args.boardId)
  if (cards.length < 2) throw new Error('The board needs at least 2 references.')
  const n = Math.min(Math.max(args.count ?? 9, 4), 12)
  const look = cards.slice(0, MAX_LOOK)
  const images = await Promise.all(look.map((c: any) => loadImage(c.grid ?? c.thumb)))

  const breadth: Breadth = args.breadth && args.breadth in MIX ? args.breadth : 'balanced'
  const context = args.context?.trim() || undefined
  const content: any[] = [{ type: 'text', text: PROMPT({ n, board: board.name, context, breadth, direction: args.direction, wanted: args.applications }) }]
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
      return { brief: clean(brief, board, cards, { context, breadth }), cost: Number(json.usage?.cost ?? 0) }
    } catch (e) {
      if (model === BRIEF_FALLBACK) throw e
    }
  }
  throw new Error('unreachable')
}

const RATIOS = new Set(['1:1', '4:5', '3:4', '2:3', '16:9', '3:2', '9:16', '5:4', '4:3'])

/** Normalises the model's brief so later steps can trust its shape. */
export function clean(b: any, board: any, cards: any[], opts: { context?: string; breadth?: Breadth } = {}): Brief {
  const ids = new Set(cards.map((c) => c.id))
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(/\s*[,;]\s*/).filter(Boolean) : [])
  const palette = (Array.isArray(b.palette) ? b.palette : [])
    .filter((p: any) => /^#[0-9a-f]{6}$/i.test(str(p?.hex)))
    .slice(0, 6)
    .map((p: any) => ({ hex: p.hex.toLowerCase(), name: str(p.name), role: str(p.role), share: Number(p.share) || 0 }))
  if (!palette.length) throw new Error('brief has no palette')
  const firstId = cards[0]?.id
  const apps = (Array.isArray(b.applications) ? b.applications : []).map((a: any, i: number) => {
    const lead = ids.has(Number(a.lead)) ? Number(a.lead) : (list(a.anchors).map(Number).find((id) => ids.has(id)) ?? firstId)
    return {
    key: str(a.key) || `tile-${i + 1}`,
    title: str(a.title) || `Application ${i + 1}`,
    category: str(a.category),
    tier: (['core', 'stretch', 'look'].includes(a.tier) ? a.tier : 'core') as Application['tier'],
    why: str(a.why),
    scene: str(a.scene),
    aspect_ratio: RATIOS.has(str(a.aspect_ratio)) ? a.aspect_ratio : '4:5',
    kind: (MEDIA_KINDS as readonly string[]).includes(str(a.kind)) ? (a.kind as MediaKind) : 'photography',
    lead,
    devices: list(a.devices).slice(0, 4),
    headline: str(a.headline).trim().split(/\s+/).slice(0, 5).join(' '),
    anchors: list(a.anchors).map(Number).filter((id) => ids.has(id) && id !== lead).slice(0, 1),
  }
  })
  if (!apps.length) throw new Error('brief has no applications')
  return {
    name: str(b.name) || `${board.name} look`,
    idea: str(b.idea),
    context: opts.context ?? str(b.context),
    context_inferred: !opts.context,
    breadth: opts.breadth ?? 'balanced',
    mood: list(b.mood).slice(0, 6),
    voice: str(b.voice),
    palette,
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
    signatures: (Array.isArray(b.signatures) ? b.signatures : [])
      .filter((x: any) => ids.has(Number(x?.id)))
      .map((x: any) => ({ id: Number(x.id), kind: ((MEDIA_KINDS as readonly string[]).includes(str(x.kind)) ? x.kind : 'photography') as MediaKind, devices: list(x.devices).slice(0, 4) })),
    applications: apps,
    source: { board_id: Number(board.id), board_name: board.name, reference_ids: cards.map((c) => c.id) },
  }
}
