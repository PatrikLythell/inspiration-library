'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Card = {
  id: number
  sourceKey: string
  source: string
  description: string
  thumb: string | null
  grid: string | null
  large: string | null
  width: number | null
  height: number | null
  palette: string[]
  tags: Record<string, string[]>
  credit: string
  brand: string
  sourceUrl: string | null
  score?: number
}

type Facet = { value: string; count: number }
type TagMap = Record<string, string[]>

const PAGE = 60
const GAP = 6
const CATEGORY_LABEL: Record<string, string> = {
  mood: 'Mood',
  style: 'Style',
  medium: 'Medium',
  subject: 'Subject',
  era_reference: 'Era',
  typography_style: 'Typography',
  colour_character: 'Colour',
  composition: 'Composition',
  source: 'Source',
}
const SWATCHES = [
  '#d93a32', '#ef7d2d', '#f2c230', '#8bbf3f', '#2e9e5b', '#2bb3a8',
  '#2f7fd1', '#3446a8', '#7a45b8', '#d14f96', '#8a5a3c', '#f1e6d0',
  '#ffffff', '#9a9a9a', '#111111',
]

/** "#calm #riso @brandarchive warm poster" → words + tag/source tokens */
function parseQuery(raw: string) {
  const anyTags: string[] = []
  const sources: string[] = []
  const words: string[] = []
  for (const tok of raw.trim().split(/\s+/).filter(Boolean)) {
    if (tok.startsWith('#') && tok.length > 1) anyTags.push(tok.slice(1).replace(/_/g, ' '))
    else if (tok.startsWith('@') && tok.length > 1) sources.push(tok.slice(1).toLowerCase())
    else words.push(tok)
  }
  return { words: words.join(' '), anyTags, sources }
}

const toggle = (m: TagMap, cat: string, v: string): TagMap => {
  const cur = m[cat] ?? []
  const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]
  const out = { ...m, [cat]: next }
  if (!next.length) delete out[cat]
  return out
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/references${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 401) {
    window.location.href = '/admin/login?redirect=%2Flibrary'
    throw new Error('signed out')
  }
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

/** Shrinks a dropped or pasted image so the request stays small. */
function downscale(file: Blob, max = 768): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * s)
      c.height = Math.round(img.height * s)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(img.src)
      resolve(c.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

type Row = { items: { card: Card; index: number; w: number }[]; h: number }

/** Justified rows: every row fills the width, keeping each image's aspect ratio. */
function justify(cards: Card[], width: number, target: number): Row[] {
  const rows: Row[] = []
  let cur: { card: Card; index: number; ar: number }[] = []
  let sum = 0
  cards.forEach((card, index) => {
    const ar = card.width && card.height ? Math.min(3, Math.max(0.4, card.width / card.height)) : 1.33
    cur.push({ card, index, ar })
    sum += ar
    const full = sum * target + GAP * (cur.length - 1)
    if (full >= width) {
      const h = (width - GAP * (cur.length - 1)) / sum
      rows.push({ items: cur.map((c) => ({ card: c.card, index: c.index, w: c.ar * h })), h })
      cur = []
      sum = 0
    }
  })
  if (cur.length) rows.push({ items: cur.map((c) => ({ card: c.card, index: c.index, w: c.ar * target })), h: target })
  return rows
}

export function Library({ initialRef }: { initialRef?: number }) {
  const [raw, setRaw] = useState('')
  const [debounced, setDebounced] = useState('')
  const [include, setInclude] = useState<TagMap>({})
  const [exclude, setExclude] = useState<TagMap>({})
  const [colors, setColors] = useState<string[]>([])
  const [imageQuery, setImageQuery] = useState<string | null>(null)
  const [similarTo, setSimilarTo] = useState<number[] | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [ms, setMs] = useState<number | null>(null)
  const [facets, setFacets] = useState<Record<string, Facet[]>>({})
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({ mood: true, style: true, source: true })
  const [rowH, setRowH] = useState(220)
  const [width, setWidth] = useState(1000)
  const [focus, setFocus] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [lightbox, setLightbox] = useState<Card | null>(null)
  const [dragging, setDragging] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const reqId = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(raw), 250)
    return () => clearTimeout(t)
  }, [raw])

  const parsed = useMemo(() => parseQuery(debounced), [debounced])
  const filters = useMemo(() => {
    const src = [...(include.source ?? []), ...parsed.sources]
    const tags = { ...include }
    delete tags.source
    const ex = { ...exclude }
    delete ex.source
    return {
      tags,
      excludeTags: ex,
      anyTags: parsed.anyTags,
      sources: src.length ? src : undefined,
    }
  }, [include, exclude, parsed])

  const load = useCallback(
    async (reset: boolean) => {
      const id = ++reqId.current
      setLoading(true)
      try {
        const offset = reset ? 0 : cards.length
        const t0 = performance.now()
        let res: { results: Card[]; total?: number }
        if (similarTo) {
          res = reset ? await api('/similar', { ids: similarTo, limit: 96, filters }) : { results: [] }
        } else {
          res = await api('/search', {
            query: parsed.words || undefined,
            imageUrl: imageQuery ?? undefined,
            colors: colors.length ? colors : undefined,
            filters,
            limit: PAGE,
            offset,
          })
        }
        if (id !== reqId.current) return
        setMs(Math.round(performance.now() - t0))
        setCards((prev) => (reset ? res.results : [...prev, ...res.results]))
        setTotal(res.total ?? null)
        setHasMore(!similarTo && res.results.length === PAGE)
        if (reset) {
          setFocus(0)
          gridRef.current?.scrollTo({ top: 0 })
        }
      } catch (e) {
        if (id === reqId.current) setToast(`Search failed (${(e as Error).message})`)
      } finally {
        if (id === reqId.current) setLoading(false)
      }
    },
    [cards.length, similarTo, filters, parsed.words, imageQuery, colors],
  )

  // New query or filters: start over.
  useEffect(() => {
    void load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, parsed.words, imageQuery, colors, similarTo])

  useEffect(() => {
    api<Record<string, Facet[]>>('/facets', { filters }).then(setFacets).catch(() => undefined)
  }, [filters])

  // Infinite scroll.
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((e) => {
      if (e[0].isIntersecting && hasMore && !loading) void load(false)
    }, { root: gridRef.current, rootMargin: '800px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loading, load])

  // Grid width for the justified layout.
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 24))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Deep link: /library?ref=123 opens that reference.
  useEffect(() => {
    if (initialRef) api<Card>(`/${initialRef}/card`).then(setLightbox).catch(() => undefined)
  }, [initialRef])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const rows = useMemo(() => justify(cards, Math.max(200, width), rowH), [cards, width, rowH])
  const rowOf = useMemo(() => {
    const m = new Map<number, number>()
    rows.forEach((r, ri) => r.items.forEach((it) => m.set(it.index, ri)))
    return m
  }, [rows])

  const moreLikeThese = useCallback((ids: number[]) => {
    setLightbox(null)
    setImageQuery(null)
    setSimilarTo(ids)
  }, [])

  const clearAll = () => {
    setRaw('')
    setInclude({})
    setExclude({})
    setColors([])
    setImageQuery(null)
    setSimilarTo(null)
    setSelected(new Set())
  }

  const openCard = (i: number) => {
    setFocus(i)
    setLightbox(cards[i])
  }

  // Keyboard: / search, arrows move, space/enter preview, S similar, X select, ⌘A all, Esc close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT'
      if (typing) {
        if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
        return
      }
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (e.key === 'Escape') {
        if (lightbox) setLightbox(null)
        else if (selected.size) setSelected(new Set())
        else if (similarTo) setSimilarTo(null)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault()
        setSelected(new Set(cards.map((c) => c.id)))
        return
      }
      if (!cards.length) return
      const move = (to: number) => {
        const i = Math.max(0, Math.min(cards.length - 1, to))
        setFocus(i)
        if (lightbox) setLightbox(cards[i])
        document.querySelector(`[data-idx="${i}"]`)?.scrollIntoView({ block: 'nearest' })
      }
      if (e.key === 'ArrowRight') move(focus + 1)
      else if (e.key === 'ArrowLeft') move(focus - 1)
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const r = rowOf.get(focus) ?? 0
        const target = rows[r + (e.key === 'ArrowDown' ? 1 : -1)]
        if (!target) return
        const col = rows[r].items.findIndex((it) => it.index === focus)
        move(target.items[Math.min(col, target.items.length - 1)].index)
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setLightbox(lightbox ? null : cards[focus])
      } else if (e.key === 's' || e.key === 'S') {
        moreLikeThese(selected.size ? [...selected] : [cards[focus].id])
      } else if (e.key === 'x' || e.key === 'X') {
        const id = cards[focus].id
        setSelected((s) => {
          const n = new Set(s)
          if (n.has(id)) n.delete(id)
          else n.add(id)
          return n
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cards, focus, lightbox, selected, similarTo, rows, rowOf, moreLikeThese])

  // Drop or paste an image (or image URL) anywhere to search by it.
  const searchByBlob = async (blob: Blob) => {
    try {
      const url = await downscale(blob)
      setSimilarTo(null)
      setImageQuery(url)
    } catch {
      setToast('Could not read that image')
    }
  }
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (file) void searchByBlob(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'))
    if (file) return void searchByBlob(file)
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    if (/^https?:\/\//.test(url)) {
      setSimilarTo(null)
      setImageQuery(url.trim())
    }
  }

  const filterChips = [
    ...Object.entries(include).flatMap(([c, vs]) => vs.map((v) => ({ c, v, ex: false }))),
    ...Object.entries(exclude).flatMap(([c, vs]) => vs.map((v) => ({ c, v, ex: true }))),
  ]
  const modeLabel = similarTo
    ? `Similar to ${similarTo.length === 1 ? 'one reference' : `${similarTo.length} references`}`
    : imageQuery
      ? 'Searching by image'
      : parsed.words
        ? `“${parsed.words}”`
        : 'Newest'

  return (
    <div
      className="lib"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <aside className="lib-side">
        <div className="lib-brand">
          <span className="lib-logo" aria-hidden>◐</span> Library
        </div>

        <section className="lib-section">
          <h3>Colour</h3>
          <div className="lib-swatches">
            {SWATCHES.map((hex) => (
              <button
                key={hex}
                className={`lib-swatch${colors.includes(hex) ? ' on' : ''}`}
                style={{ background: hex }}
                title={hex}
                onClick={() =>
                  setColors((c) => (c.includes(hex) ? c.filter((x) => x !== hex) : [...c, hex].slice(-3)))
                }
              />
            ))}
            <label className="lib-swatch lib-picker" title="Pick any colour">
              +
              <input
                type="color"
                onChange={(e) => {
                  const v = e.target.value
                  setColors((c) => [...c.filter((x) => x !== v), v].slice(-3))
                }}
              />
            </label>
          </div>
        </section>

        {['source', 'mood', 'style', 'medium', 'subject', 'era_reference', 'typography_style', 'colour_character', 'composition'].map(
          (cat) => {
            const list = facets[cat] ?? []
            if (!list.length) return null
            const open = openCats[cat]
            return (
              <section key={cat} className="lib-section">
                <h3 className="lib-toggle" onClick={() => setOpenCats((o) => ({ ...o, [cat]: !o[cat] }))}>
                  <span>{open ? '▾' : '▸'}</span> {CATEGORY_LABEL[cat]}
                </h3>
                {open && (
                  <ul className="lib-facets">
                    {list.slice(0, 14).map((f) => {
                      const on = include[cat]?.includes(f.value)
                      const off = exclude[cat]?.includes(f.value)
                      return (
                        <li
                          key={f.value}
                          className={on ? 'on' : off ? 'off' : ''}
                          title="Click to include, Alt-click to exclude"
                          onClick={(e) => {
                            if (e.altKey) {
                              setExclude((m) => toggle(m, cat, f.value))
                              setInclude((m) => (m[cat]?.includes(f.value) ? toggle(m, cat, f.value) : m))
                            } else {
                              setInclude((m) => toggle(m, cat, f.value))
                              setExclude((m) => (m[cat]?.includes(f.value) ? toggle(m, cat, f.value) : m))
                            }
                          }}
                        >
                          <span>{f.value}</span>
                          <em>{f.count}</em>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )
          },
        )}
        <p className="lib-hint">
          Alt-click a filter to exclude it. Drop or paste an image anywhere to search by it.
        </p>
      </aside>

      <main className="lib-main">
        <header className="lib-top">
          <div className="lib-search">
            <input
              ref={searchRef}
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value)
                if (similarTo) setSimilarTo(null)
              }}
              placeholder="Describe a look… e.g. grainy 70s print  #calm  @brandarchive   ( / to focus )"
              spellCheck={false}
            />
            {imageQuery && (
              <span className="lib-imgchip">
                <img src={imageQuery} alt="" />
                <button onClick={() => setImageQuery(null)} aria-label="Stop searching by image">
                  ×
                </button>
              </span>
            )}
          </div>
          <label className="lib-zoom" title="Thumbnail size">
            <span>▫</span>
            <input type="range" min={110} max={420} value={rowH} onChange={(e) => setRowH(Number(e.target.value))} />
            <span>◻</span>
          </label>
        </header>

        <div className="lib-status">
          <strong>{modeLabel}</strong>
          {total !== null && <span>{total.toLocaleString()} refs</span>}
          {ms !== null && <span>{ms} ms</span>}
          {colors.map((c) => (
            <button key={c} className="lib-chip" onClick={() => setColors((x) => x.filter((y) => y !== c))}>
              <i style={{ background: c }} /> {c} ×
            </button>
          ))}
          {filterChips.map(({ c, v, ex }) => (
            <button
              key={`${ex}${c}${v}`}
              className={`lib-chip${ex ? ' ex' : ''}`}
              onClick={() => (ex ? setExclude((m) => toggle(m, c, v)) : setInclude((m) => toggle(m, c, v)))}
            >
              {ex ? 'not ' : ''}
              {v} ×
            </button>
          ))}
          {(filterChips.length > 0 || colors.length > 0 || similarTo || imageQuery || raw) && (
            <button className="lib-link" onClick={clearAll}>
              Clear all
            </button>
          )}
          {loading && <span className="lib-spin" />}
        </div>

        <div className="lib-grid" ref={gridRef}>
          {rows.map((r, ri) => (
            <div className="lib-row" key={ri} style={{ height: r.h }}>
              {r.items.map(({ card, index, w }) => {
                const src = (r.h > 240 ? card.grid : card.thumb) ?? card.grid ?? card.thumb ?? ''
                return (
                  <figure
                    key={card.id}
                    data-idx={index}
                    className={`lib-card${index === focus ? ' focus' : ''}${selected.has(card.id) ? ' sel' : ''}`}
                    style={{ width: w, height: r.h, background: card.palette[0] ?? '#2a2a2d' }}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey) {
                        setFocus(index)
                        setSelected((s) => {
                          const n = new Set(s)
                          if (n.has(card.id)) n.delete(card.id)
                          else n.add(card.id)
                          return n
                        })
                      } else openCard(index)
                    }}
                  >
                    <img src={src} alt={card.description} loading="lazy" decoding="async" />
                    <figcaption>
                      <span className="lib-pal">
                        {card.palette.slice(0, 5).map((p, i) => (
                          <i key={i} style={{ background: p }} />
                        ))}
                      </span>
                      <span className="lib-credit">{card.credit}</span>
                    </figcaption>
                    <button
                      className="lib-more"
                      title="More like this (S)"
                      onClick={(e) => {
                        e.stopPropagation()
                        moreLikeThese([card.id])
                      }}
                    >
                      ≈
                    </button>
                  </figure>
                )
              })}
            </div>
          ))}
          {!loading && cards.length === 0 && <p className="lib-empty">Nothing matches. Try fewer filters.</p>}
          <div ref={sentinel} style={{ height: 1 }} />
        </div>

        {selected.size > 0 && (
          <div className="lib-selbar">
            <span>{selected.size} selected</span>
            <button onClick={() => moreLikeThese([...selected])}>More like these (S)</button>
            <button className="lib-link" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}
      </main>

      {lightbox && (
        <Lightbox
          card={lightbox}
          onClose={() => setLightbox(null)}
          onOpen={setLightbox}
          onTag={(cat, v) => {
            setLightbox(null)
            setInclude((m) => (m[cat]?.includes(v) ? m : toggle(m, cat, v)))
          }}
          onSimilar={(id) => moreLikeThese([id])}
          onCopy={(hex) => {
            void navigator.clipboard?.writeText(hex)
            setToast(`Copied ${hex}`)
          }}
        />
      )}

      {dragging && <div className="lib-drop">Drop an image to find references that look like it</div>}
      {toast && <div className="lib-toast">{toast}</div>}
    </div>
  )
}

function Lightbox({
  card,
  onClose,
  onOpen,
  onTag,
  onSimilar,
  onCopy,
}: {
  card: Card
  onClose: () => void
  onOpen: (c: Card) => void
  onTag: (cat: string, v: string) => void
  onSimilar: (id: number) => void
  onCopy: (hex: string) => void
}) {
  const [similar, setSimilar] = useState<Card[] | null>(null)
  useEffect(() => {
    setSimilar(null)
    let live = true
    api<{ results: Card[] }>(`/${card.id}/similar?limit=24`)
      .then((r) => live && setSimilar(r.results))
      .catch(() => live && setSimilar([]))
    return () => {
      live = false
    }
  }, [card.id])

  return (
    <div className="lib-lb" onClick={onClose}>
      <div className="lib-lb-img" onClick={(e) => e.stopPropagation()}>
        <img src={card.large ?? card.grid ?? card.thumb ?? ''} alt={card.description} />
      </div>
      <aside className="lib-lb-panel" onClick={(e) => e.stopPropagation()}>
        <button className="lib-lb-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <p className="lib-lb-desc">{card.description}</p>
        <div className="lib-lb-pal">
          {card.palette.map((p) => (
            <button key={p} title={`Copy ${p}`} onClick={() => onCopy(p)}>
              <i style={{ background: p }} />
              {p}
            </button>
          ))}
        </div>
        <dl className="lib-lb-meta">
          {card.credit && (
            <>
              <dt>Credit</dt>
              <dd>{card.credit}</dd>
            </>
          )}
          <dt>Source</dt>
          <dd>
            {card.source}
            {card.sourceUrl && (
              <>
                {' · '}
                <a href={card.sourceUrl} target="_blank" rel="noreferrer">
                  View on source ↗
                </a>
              </>
            )}
          </dd>
        </dl>
        {Object.entries(CATEGORY_LABEL)
          .filter(([k]) => k !== 'source' && card.tags?.[k]?.length)
          .map(([k, label]) => (
            <div key={k} className="lib-lb-tags">
              <span>{label}</span>
              <div>
                {card.tags[k]
                  .filter((v) => !['none', 'n/a'].includes(String(v).toLowerCase()))
                  .map((v) => (
                    <button key={v} onClick={() => onTag(k, v)} title="Filter by this tag">
                      {v}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        <div className="lib-lb-simhead">
          <h4>Looks like</h4>
          <button className="lib-link" onClick={() => onSimilar(card.id)}>
            Open all as results (S)
          </button>
        </div>
        <div className="lib-lb-sim">
          {similar === null && <span className="lib-spin" />}
          {similar?.map((s) => (
            <button key={s.id} onClick={() => onOpen(s)} title={s.credit}>
              <img src={s.thumb ?? s.grid ?? ''} alt={s.description} loading="lazy" />
            </button>
          ))}
        </div>
      </aside>
    </div>
  )
}
