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
type Board = { id: number; name: string; parent: number | null; count: number; covers: string[] }
const REF_MIME = 'application/x-reference-ids'
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

async function boardsApi<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(`/api/boards${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

/** Shrinks a dropped or pasted image so the request stays small (2400 px keeps uploads under the 4.5 MB limit). */
function downscale(file: Blob, max = 768, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * s)
      c.height = Math.round(img.height * s)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(img.src)
      resolve(c.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

/** Everything that defines what the library shows; mirrored into the URL so back/forward work. */
type View = {
  q: string
  include: TagMap
  exclude: TagMap
  colors: string[]
  sim: number[] | null
  board: number | null
  ref: number | null
  img: string | null
}

function viewToParams(v: View): URLSearchParams {
  const p = new URLSearchParams()
  if (v.q.trim()) p.set('q', v.q.trim())
  for (const [c, vs] of Object.entries(v.include)) for (const x of vs) p.append('f', `${c}:${x}`)
  for (const [c, vs] of Object.entries(v.exclude)) for (const x of vs) p.append('x', `${c}:${x}`)
  if (v.colors.length) p.set('c', v.colors.map((c) => c.replace('#', '')).join(','))
  if (v.img) p.set('img', v.img.startsWith('data:') ? 'local' : v.img)
  if (v.sim?.length) p.set('sim', v.sim.join(','))
  if (v.board) p.set('board', String(v.board))
  if (v.ref) p.set('ref', String(v.ref))
  return p
}

function paramsToView(p: URLSearchParams, localImg?: string | null): View {
  const tags = (key: string) => {
    const m: TagMap = {}
    for (const t of p.getAll(key)) {
      const i = t.indexOf(':')
      if (i > 0) m[t.slice(0, i)] = [...(m[t.slice(0, i)] ?? []), t.slice(i + 1)]
    }
    return m
  }
  const num = (k: string) => (p.get(k) && Number(p.get(k))) || null
  const img = p.get('img')
  const sim = (p.get('sim') ?? '').split(',').map(Number).filter(Boolean)
  return {
    q: p.get('q') ?? '',
    include: tags('f'),
    exclude: tags('x'),
    colors: (p.get('c') ?? '').split(',').filter(Boolean).map((c) => `#${c}`),
    sim: sim.length ? sim : null,
    board: num('board'),
    ref: num('ref'),
    img: img === 'local' ? (localImg ?? null) : img,
  }
}

type Crumb = { label: string; depth: number }
type NavState = { depth: number; crumbs: Crumb[]; img?: string | null; closeBack?: boolean }

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

export function Library({ initial }: { initial: string }) {
  const start = useMemo(() => paramsToView(new URLSearchParams(initial)), [initial])
  const [raw, setRaw] = useState(start.q)
  const [debounced, setDebounced] = useState(start.q)
  const [include, setInclude] = useState<TagMap>(start.include)
  const [exclude, setExclude] = useState<TagMap>(start.exclude)
  const [colors, setColors] = useState<string[]>(start.colors)
  const [imageQuery, setImageQuery] = useState<string | null>(start.img)
  const [similarTo, setSimilarTo] = useState<number[] | null>(start.sim)
  const [refId, setRefId] = useState<number | null>(start.ref)
  const [nav, setNav] = useState<NavState>({ depth: 0, crumbs: [] })
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
  const [lightbox, setLightboxCard] = useState<Card | null>(null)
  const [dragging, setDragging] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [boards, setBoards] = useState<Board[]>([])
  const [board, setBoard] = useState<number | null>(start.board)
  const [boardDrop, setBoardDrop] = useState<number | null>(null)
  const [picker, setPicker] = useState<number[] | null>(null)
  const [newBoard, setNewBoard] = useState<string | null>(null)
  const [adding, setAdding] = useState(0)
  const [dropZone, setDropZone] = useState<'search' | 'add' | null>(null)
  const queryBlob = useRef<Blob | string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
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
        if (board) {
          res = reset ? await boardsApi(`/${board}/cards`) : { results: [] }
        } else if (similarTo) {
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
        setHasMore(!board && !similarTo && res.results.length === PAGE)
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
    [cards.length, board, similarTo, filters, parsed.words, imageQuery, colors],
  )

  // New query or filters: start over.
  useEffect(() => {
    void load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, parsed.words, imageQuery, colors, similarTo, board])

  useEffect(() => {
    api<Record<string, Facet[]>>('/facets', { filters }).then(setFacets).catch(() => undefined)
  }, [filters])

  const loadBoards = useCallback(() => {
    boardsApi<{ boards: Board[] }>('/overview')
      .then((r) => setBoards(r.boards))
      .catch(() => undefined)
  }, [])
  useEffect(loadBoards, [loadBoards])

  const boardName = boards.find((b) => b.id === board)?.name ?? 'Board'

  const putOnBoard = useCallback(
    async (boardId: number, ids: number[]) => {
      try {
        await boardsApi(`/${boardId}/items`, { add: ids })
        setToast(`Added ${ids.length === 1 ? '1 reference' : `${ids.length} references`} to ${boards.find((b) => b.id === boardId)?.name ?? 'board'}`)
        loadBoards()
        if (board === boardId) void load(true)
      } catch {
        setToast('Could not add to the board')
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boards, board, loadBoards],
  )

  const createBoard = async (name: string, ids: number[] = []) => {
    const n = name.trim()
    if (!n) return
    try {
      const { doc } = await boardsApi<{ doc: { id: number } }>('', { name: n })
      if (ids.length) await boardsApi(`/${doc.id}/items`, { add: ids })
      setToast(ids.length ? `Created ${n} with ${ids.length} reference${ids.length > 1 ? 's' : ''}` : `Created ${n}`)
      loadBoards()
      return doc.id
    } catch {
      setToast('Could not create the board')
    }
  }

  const removeFromBoard = async (ids: number[]) => {
    if (!board) return
    await boardsApi(`/${board}/items`, { remove: ids }).catch(() => undefined)
    setCards((cs) => cs.filter((c) => !ids.includes(c.id)))
    setSelected(new Set())
    loadBoards()
  }

  const deleteBoard = async (id: number) => {
    if (!window.confirm(`Delete the board “${boards.find((b) => b.id === id)?.name}”? The references stay in the library.`)) return
    await boardsApi(`/${id}`, undefined, 'DELETE').catch(() => undefined)
    if (board === id) setBoard(null)
    loadBoards()
  }

  const openBoard = (id: number | null) => {
    setBoard(id)
    setSelected(new Set())
    setSimilarTo(null)
    setImageQuery(null)
    setRefId(null)
    setLightboxCard(null)
  }

  /** Adds images (files or links) to the library, and to the open board. */
  const addToLibrary = async (items: (Blob | string)[], target: number | null = board) => {
    if (!items.length) return
    setAdding((n) => n + items.length)
    let added = 0
    let dupes = 0
    let failed = 0
    await Promise.all(
      items.map(async (it) => {
        try {
          const body =
            typeof it === 'string'
              ? { url: it, board: target }
              : { image: await downscale(it, 2400, 0.9), filename: (it as File).name, board: target }
          const res = await fetch('/api/references/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
          })
          const j = await res.json()
          if (!res.ok) throw new Error(j.error)
          if (j.duplicate) dupes++
          else added++
        } catch {
          failed++
        } finally {
          setAdding((n) => n - 1)
        }
      }),
    )
    setToast(
      [added && `Added ${added}`, dupes && `${dupes} already in the library`, failed && `${failed} failed`]
        .filter(Boolean)
        .join(' · ') + (target && added + dupes ? ` → ${boards.find((b) => b.id === target)?.name ?? 'board'}` : ''),
    )
    loadBoards()
    if (!target || target === board) void load(true)
  }

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

  /** Opens (or closes) the lightbox; the open image is part of the URL. */
  const setLightbox = useCallback((c: Card | null) => {
    setLightboxCard(c)
    setRefId(c?.id ?? null)
  }, [])

  // The URL names the open image: load its card when it is not the one shown (deep links, back/forward).
  useEffect(() => {
    if (!refId) return setLightboxCard(null)
    if (lightbox?.id === refId) return
    let live = true
    api<Card>(`/${refId}/card`)
      .then((c) => live && setLightboxCard(c))
      .catch(() => undefined)
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refId])

  // ---- Browser history: every view gets its own URL, so back/forward retrace the path. ----
  const replaceNext = useRef(false)
  const labelRef = useRef('Newest')
  const view: View = useMemo(
    () => ({ q: debounced, include, exclude, colors, sim: similarTo, board, ref: refId, img: imageQuery }),
    [debounced, include, exclude, colors, similarTo, board, refId, imageQuery],
  )
  useEffect(() => {
    const qs = viewToParams(view).toString()
    const url = qs ? `/library?${qs}` : '/library'
    const here = window.location.pathname + window.location.search
    const cur: NavState = window.history.state?.depth !== undefined ? window.history.state : { depth: 0, crumbs: [] }
    if (url === here) {
      if (window.history.state?.depth === undefined) window.history.replaceState({ ...cur, img: view.img }, '', url)
      setNav(cur)
      return
    }
    const before = new URLSearchParams(window.location.search)
    const after = new URLSearchParams(qs)
    before.delete('q')
    after.delete('q')
    const typingOnly = before.toString() === after.toString()
    if (replaceNext.current || typingOnly) {
      replaceNext.current = false
      const next = { ...cur, img: view.img?.startsWith('data:') ? view.img : null }
      window.history.replaceState(next, '', url)
      setNav(next)
      return
    }
    // Opening an image from the same view: closing it again steps back instead of adding history.
    const withoutRef = new URLSearchParams(qs)
    withoutRef.delete('ref')
    const fromHere = new URLSearchParams(window.location.search)
    const closeBack = Boolean(view.ref) && !fromHere.get('ref') && withoutRef.toString() === fromHere.toString()
    const next: NavState = {
      depth: cur.depth + 1,
      crumbs: [...cur.crumbs, { label: labelRef.current, depth: cur.depth }].slice(-8),
      img: view.img?.startsWith('data:') ? view.img : null,
      closeBack,
    }
    window.history.pushState(next, '', url)
    setNav(next)
  }, [view])

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const v = paramsToView(new URLSearchParams(window.location.search), e.state?.img)
      setRaw(v.q)
      setDebounced(v.q)
      setInclude(v.include)
      setExclude(v.exclude)
      setColors(v.colors)
      setImageQuery(v.img)
      setSimilarTo(v.sim)
      setBoard(v.board)
      setRefId(v.ref)
      setSelected(new Set())
      setNav(e.state?.depth !== undefined ? e.state : { depth: 0, crumbs: [] })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const closeLightbox = useCallback(() => {
    if (window.history.state?.closeBack) window.history.back()
    else setLightbox(null)
  }, [setLightbox])

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
      if (picker && !typing && e.key !== 'Escape') return
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
        if (picker) setPicker(null)
        else if (lightbox) closeLightbox()
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
        if (lightbox) {
          replaceNext.current = true
          setLightbox(cards[i])
        }
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
        if (lightbox) closeLightbox()
        else setLightbox(cards[focus])
      } else if (e.key === 's' || e.key === 'S') {
        moreLikeThese(selected.size ? [...selected] : [cards[focus].id])
      } else if (e.key === 'b' || e.key === 'B') {
        e.preventDefault()
        setPicker(selected.size ? [...selected] : [cards[focus].id])
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && board) {
        void removeFromBoard(selected.size ? [...selected] : [cards[focus].id])
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
  }, [cards, focus, lightbox, selected, similarTo, rows, rowOf, moreLikeThese, picker, board, closeLightbox, setLightbox])

  // Drop or paste an image (or image URL) anywhere to search by it.
  const searchByBlob = async (blob: Blob) => {
    try {
      const url = await downscale(blob)
      queryBlob.current = blob
      setBoard(null)
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
  const external = (e: React.DragEvent) => !e.dataTransfer.types.includes(REF_MIME)
  const onDrop = (e: React.DragEvent, mode: 'search' | 'add' = 'search') => {
    e.preventDefault()
    setDragging(false)
    setDropZone(null)
    if (!external(e)) return
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
    const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).trim()
    if (mode === 'add') {
      if (files.length) return void addToLibrary(files)
      if (/^https?:\/\//.test(url)) return void addToLibrary([url])
      return
    }
    if (files[0]) return void searchByBlob(files[0])
    if (/^https?:\/\//.test(url)) {
      queryBlob.current = url
      setBoard(null)
      setSimilarTo(null)
      setImageQuery(url)
    }
  }
  const dragIds = (e: React.DragEvent, id: number) => {
    const ids = selected.has(id) ? [...selected] : [id]
    e.dataTransfer.setData(REF_MIME, JSON.stringify(ids))
    e.dataTransfer.effectAllowed = 'copy'
  }
  const dropOnBoard = (e: React.DragEvent, boardId: number) => {
    e.preventDefault()
    e.stopPropagation()
    setBoardDrop(null)
    setDragging(false)
    const raw = e.dataTransfer.getData(REF_MIME)
    if (raw) return void putOnBoard(boardId, JSON.parse(raw))
    // Files or links dropped on a board: add them to the library and that board.
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
    const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).trim()
    if (files.length) void addToLibrary(files, boardId)
    else if (/^https?:\/\//.test(url)) void addToLibrary([url], boardId)
  }

  const shortDesc = (d: string) => (d.split(/\s+/).slice(0, 5).join(' ') + (d.split(/\s+/).length > 5 ? '…' : '')).replace(/^(A|An|The) /, '')
  const viewLabel = useMemo(() => {
    const base = board
      ? `Board: ${boards.find((b) => b.id === board)?.name ?? 'Board'}`
      : similarTo
        ? `Similar to ${similarTo.length === 1 ? `#${similarTo[0]}` : `${similarTo.length} refs`}`
        : imageQuery
          ? 'By image'
          : debounced.trim()
            ? `“${debounced.trim()}”`
            : 'Newest'
    return refId ? `${lightbox?.description ? shortDesc(lightbox.description) : `#${refId}`}` : base
  }, [board, boards, similarTo, imageQuery, debounced, refId, lightbox])
  useEffect(() => {
    labelRef.current = viewLabel
  })

  const filterChips = [
    ...Object.entries(include).flatMap(([c, vs]) => vs.map((v) => ({ c, v, ex: false }))),
    ...Object.entries(exclude).flatMap(([c, vs]) => vs.map((v) => ({ c, v, ex: true }))),
  ]
  const modeLabel = board
    ? `Board: ${boardName}`
    : similarTo
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
        if (external(e)) setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget || !(e.currentTarget as Node).contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => onDrop(e, 'search')}
    >
      <aside className="lib-side">
        <div className="lib-brand">
          <span className="lib-logo" aria-hidden>◐</span> Library
        </div>

        <section className="lib-section">
          <h3 className="lib-boardhead">
            Boards
            <button className="lib-link" title="New board" onClick={() => setNewBoard('')}>
              + New
            </button>
          </h3>
          <ul className="lib-boards">
            <li className={board === null ? 'on' : ''} onClick={() => openBoard(null)}>
              <span className="lib-bcover all">◐</span>
              <span className="lib-bname">All references</span>
            </li>
            {sortBoards(boards).map(({ b, depth }) => (
              <li
                key={b.id}
                className={`${board === b.id ? 'on' : ''}${boardDrop === b.id ? ' drop' : ''}`}
                style={{ paddingLeft: 6 + depth * 14 }}
                onClick={() => openBoard(b.id)}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setBoardDrop(b.id)
                }}
                onDragLeave={() => setBoardDrop((d) => (d === b.id ? null : d))}
                onDrop={(e) => dropOnBoard(e, b.id)}
                title="Drop references or images here"
              >
                <span className="lib-bcover">{b.covers?.[0] ? <img src={b.covers[0]} alt="" /> : null}</span>
                <span className="lib-bname">{b.name}</span>
                <em>{b.count}</em>
                <button
                  className="lib-bdel"
                  title="Delete board"
                  onClick={(e) => {
                    e.stopPropagation()
                    void deleteBoard(b.id)
                  }}
                >
                  ×
                </button>
              </li>
            ))}
            {newBoard !== null && (
              <li className="lib-bnew">
                <input
                  autoFocus
                  value={newBoard}
                  placeholder="Board name, Enter to create"
                  onChange={(e) => setNewBoard(e.target.value)}
                  onBlur={() => setNewBoard(null)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      const id = await createBoard(newBoard)
                      setNewBoard(null)
                      if (id) openBoard(id)
                    }
                  }}
                />
              </li>
            )}
          </ul>
        </section>

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
                <button
                  className="lib-save"
                  title="Add this image to the library"
                  onClick={() => queryBlob.current && void addToLibrary([queryBlob.current])}
                >
                  Save to library
                </button>
                <button onClick={() => setImageQuery(null)} aria-label="Stop searching by image">
                  ×
                </button>
              </span>
            )}
          </div>
          <button className="lib-add" onClick={() => fileRef.current?.click()} title="Add your own images (or drop them on the page)">
            {adding ? `Adding ${adding}…` : '+ Add'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void addToLibrary([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
          <label className="lib-zoom" title="Thumbnail size">
            <span>▫</span>
            <input type="range" min={110} max={420} value={rowH} onChange={(e) => setRowH(Number(e.target.value))} />
            <span>◻</span>
          </label>
        </header>

        {nav.depth > 0 && (
          <nav className="lib-trail" aria-label="Where you have been">
            <button className="lib-back" onClick={() => window.history.back()} title="Back (Alt ←)">
              ‹ Back
            </button>
            {nav.crumbs.slice(-5).map((c) => (
              <button key={c.depth} className="lib-crumb" onClick={() => window.history.go(c.depth - nav.depth)}>
                {c.label}
              </button>
            ))}
            <span className="lib-crumb cur">{viewLabel}</span>
          </nav>
        )}
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
          {board && (
            <button className="lib-link" onClick={() => openBoard(null)}>
              Back to all
            </button>
          )}
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
                    draggable
                    onDragStart={(e) => dragIds(e, card.id)}
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
                    {board && (
                      <button
                        className="lib-more lib-remove"
                        title="Remove from board (Delete)"
                        onClick={(e) => {
                          e.stopPropagation()
                          void removeFromBoard([card.id])
                        }}
                      >
                        −
                      </button>
                    )}
                  </figure>
                )
              })}
            </div>
          ))}
          {!loading && cards.length === 0 && (
            <p className="lib-empty">
              {board ? 'This board is empty. Drag references onto it in the sidebar, press B, or drop images here.' : 'Nothing matches. Try fewer filters.'}
            </p>
          )}
          <div ref={sentinel} style={{ height: 1 }} />
        </div>

        {selected.size > 0 && (
          <div className="lib-selbar">
            <span>{selected.size} selected</span>
            <button onClick={() => moreLikeThese([...selected])}>More like these (S)</button>
            <button onClick={() => setPicker([...selected])}>Add to board (B)</button>
            {board && <button onClick={() => void removeFromBoard([...selected])}>Remove from board</button>}
            <button className="lib-link" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}
      </main>

      {lightbox && (
        <Lightbox
          card={lightbox}
          onClose={closeLightbox}
          onBack={nav.depth > 0 ? () => window.history.back() : undefined}
          onOpen={setLightbox}
          onTag={(cat, v) => {
            setLightbox(null)
            setInclude((m) => (m[cat]?.includes(v) ? m : toggle(m, cat, v)))
          }}
          onSimilar={(id) => moreLikeThese([id])}
          onBoard={(id) => setPicker([id])}
          onCopy={(hex) => {
            void navigator.clipboard?.writeText(hex)
            setToast(`Copied ${hex}`)
          }}
        />
      )}

      {dragging && (
        <div className="lib-drop">
          <div
            className={`lib-dz${dropZone === 'search' ? ' on' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDropZone('search')
            }}
            onDrop={(e) => {
              e.stopPropagation()
              onDrop(e, 'search')
            }}
          >
            <b>Find look-alikes</b>
            <span>Search by this image</span>
          </div>
          <div
            className={`lib-dz${dropZone === 'add' ? ' on' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDropZone('add')
            }}
            onDrop={(e) => {
              e.stopPropagation()
              onDrop(e, 'add')
            }}
          >
            <b>{board ? `Add to ${boardName}` : 'Add to library'}</b>
            <span>Tagged and searchable in a few seconds</span>
          </div>
        </div>
      )}
      {picker && (
        <BoardPicker
          boards={boards}
          count={picker.length}
          onPick={(id) => {
            void putOnBoard(id, picker)
            setPicker(null)
          }}
          onCreate={async (name) => {
            await createBoard(name, picker)
            setPicker(null)
          }}
          onClose={() => setPicker(null)}
        />
      )}
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
  onBoard,
  onBack,
}: {
  card: Card
  onClose: () => void
  onOpen: (c: Card) => void
  onTag: (cat: string, v: string) => void
  onSimilar: (id: number) => void
  onCopy: (hex: string) => void
  onBoard: (id: number) => void
  onBack?: () => void
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
        {onBack && (
          <button className="lib-back lib-lb-back" onClick={onBack} title="Back (Alt ←)">
            ‹ Back
          </button>
        )}
        <button className="lib-lb-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <p className="lib-lb-desc">{card.description}</p>
        <div className="lib-lb-actions">
          <button onClick={() => onBoard(card.id)}>Add to board (B)</button>
          <button onClick={() => onSimilar(card.id)}>More like this (S)</button>
        </div>
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

/** Boards in tree order: parents first, children indented under them. */
function sortBoards(boards: Board[]) {
  const kids = new Map<number | null, Board[]>()
  const ids = new Set(boards.map((b) => b.id))
  for (const b of boards) {
    const p = b.parent && ids.has(b.parent) ? b.parent : null
    kids.set(p, [...(kids.get(p) ?? []), b])
  }
  const out: { b: Board; depth: number }[] = []
  const walk = (p: number | null, depth: number) => {
    for (const b of kids.get(p) ?? []) {
      out.push({ b, depth })
      if (depth < 6) walk(b.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

function BoardPicker({
  boards,
  count,
  onPick,
  onCreate,
  onClose,
}: {
  boards: Board[]
  count: number
  onPick: (id: number) => void
  onCreate: (name: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const list = boards.filter((b) => b.name.toLowerCase().includes(q.trim().toLowerCase()))
  const canCreate = q.trim() && !boards.some((b) => b.name.toLowerCase() === q.trim().toLowerCase())
  return (
    <div className="lib-pick-bg" onClick={onClose}>
      <div className="lib-pick" onClick={(e) => e.stopPropagation()}>
        <p>
          Add {count === 1 ? '1 reference' : `${count} references`} to a board
        </p>
        <input
          autoFocus
          value={q}
          placeholder="Find or create a board"
          onChange={(e) => {
            setQ(e.target.value)
            setHi(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setHi((h) => Math.min(h + 1, list.length - (canCreate ? 0 : 1)))
            else if (e.key === 'ArrowUp') setHi((h) => Math.max(h - 1, 0))
            else if (e.key === 'Escape') onClose()
            else if (e.key === 'Enter') {
              if (list[hi]) onPick(list[hi].id)
              else if (canCreate) onCreate(q.trim())
            }
          }}
        />
        <ul>
          {list.map((b, i) => (
            <li key={b.id} className={i === hi ? 'on' : ''} onMouseEnter={() => setHi(i)} onClick={() => onPick(b.id)}>
              <span>{b.name}</span>
              <em>{b.count}</em>
            </li>
          ))}
          {canCreate && (
            <li className={hi === list.length ? 'on' : ''} onMouseEnter={() => setHi(list.length)} onClick={() => onCreate(q.trim())}>
              <span>+ Create “{q.trim()}”</span>
            </li>
          )}
          {!list.length && !canCreate && <li className="lib-pick-empty">Type a name to create your first board</li>}
        </ul>
      </div>
    </div>
  )
}
