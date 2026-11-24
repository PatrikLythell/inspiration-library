/**
 * Justified-row layout for an image-only moodboard artboard: every image keeps its aspect
 * ratio, rows fill the width exactly. Returned with the tiles so any canvas tool can place them.
 */
export type Placed = { key: string; url: string; x: number; y: number; width: number; height: number }

export function justifiedLayout(
  images: { key: string; url: string; width: number; height: number }[],
  opts: { width?: number; padding?: number; gap?: number; perRow?: number } = {},
): { width: number; height: number; images: Placed[] } {
  const W = opts.width ?? 1920
  const P = opts.padding ?? 48
  const G = opts.gap ?? 16
  const perRow = opts.perRow ?? (images.length <= 4 ? 2 : 3)
  const inner = W - 2 * P
  const out: Placed[] = []
  let y = P
  for (let i = 0; i < images.length; i += perRow) {
    const row = images.slice(i, i + perRow)
    const ratio = row.reduce((s, im) => s + im.width / im.height, 0)
    // A short last row keeps the previous rows' height instead of blowing up.
    const full = (inner - G * (row.length - 1)) / ratio
    const h = row.length < perRow && out.length ? Math.min(full, out[out.length - 1].height) : full
    let x = P
    for (const im of row) {
      const w = (h * im.width) / im.height
      out.push({ key: im.key, url: im.url, x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) })
      x += w + G
    }
    y += h + G
  }
  return { width: W, height: Math.round(y - G + P), images: out }
}
