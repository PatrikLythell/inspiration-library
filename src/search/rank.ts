/**
 * "Similar" means similar LOOK. Re-rank the nearest candidates by embedding with the
 * style blend chosen in the 2026-11-21 blind test:
 *   score = 0.30·z(embedding cosine) + 0.35·z(palette similarity) + 0.35·z(style-tag cosine)
 * Palette similarity = negative symmetric mean nearest distance in CIE Lab.
 * Style tags exclude subject and keywords on purpose.
 */
export const STYLE_KEYS = [
  'style',
  'mood',
  'medium',
  'composition',
  'colour_character',
  'era_reference',
  'typography_style',
] as const

export const WEIGHTS = { embedding: 0.3, palette: 0.35, style: 0.35 }

export type Candidate = {
  id: number
  score: number // embedding cosine
  brand: string
  tags: Record<string, string[]>
  lab: number[][] // up to 6 Lab colours
}

export function hexToLab(hex: string): number[] | null {
  const h = hex?.replace('#', '')
  if (!h || h.length < 6) return null
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  if ([r, g, b].some(Number.isNaN)) return null
  const f = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const [R, G, B] = [f(r), f(g), f(b)]
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089
  const F = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * F(y) - 16, 500 * (F(x) - F(y)), 200 * (F(y) - F(z))]
}

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

export function paletteSimilarity(a: number[][], b: number[][]): number {
  if (!a.length || !b.length) return 0
  const minTo = (x: number[], ys: number[][]) => Math.min(...ys.map((y) => dist(x, y)))
  const ab = a.reduce((s, x) => s + minTo(x, b), 0) / a.length
  const ba = b.reduce((s, x) => s + minTo(x, a), 0) / b.length
  return -0.5 * (ab + ba)
}

const styleSet = (tags: Record<string, string[]>) =>
  new Set(STYLE_KEYS.flatMap((k) => (tags?.[k] ?? []).map((v) => `${k}:${v}`)))

function styleCosine(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const x of a) if (b.has(x)) shared++
  return shared / Math.sqrt(a.size * b.size)
}

const zscores = (xs: number[]) => {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length) || 1e-6
  return xs.map((x) => (x - m) / sd)
}

/** Style-blend ranking: other brands only, at most `perBrand` per brand, top `k`. */
export function styleBlend(
  query: Omit<Candidate, 'score'>,
  candidates: Candidate[],
  k = 24,
  perBrand = 2,
): { id: number; score: number; embedding: number }[] {
  const pool = candidates.filter((c) => c.id !== query.id && (!query.brand || c.brand !== query.brand))
  if (!pool.length) return []
  const qs = styleSet(query.tags)
  const ze = zscores(pool.map((c) => c.score))
  const zp = zscores(pool.map((c) => paletteSimilarity(query.lab, c.lab)))
  const zs = zscores(pool.map((c) => styleCosine(qs, styleSet(c.tags))))
  const scored = pool
    .map((c, i) => ({
      id: c.id,
      brand: c.brand,
      embedding: c.score,
      score: WEIGHTS.embedding * ze[i] + WEIGHTS.palette * zp[i] + WEIGHTS.style * zs[i],
    }))
    .sort((a, b) => b.score - a.score)
  const perBrandCount = new Map<string, number>()
  const out: { id: number; score: number; embedding: number }[] = []
  for (const s of scored) {
    const n = perBrandCount.get(s.brand) ?? 0
    if (s.brand && n >= perBrand) continue
    perBrandCount.set(s.brand, n + 1)
    out.push({ id: s.id, score: s.score, embedding: s.embedding })
    if (out.length >= k) break
  }
  return out
}
