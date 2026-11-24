import config from '@payload-config'
import { headers as getHeaders } from 'next/headers.js'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import type { Brief } from '../../../../../moodboard/brief'
import { hydrate } from '../../../../../search/lib'
import '../moodboard.css'

export const dynamic = 'force-dynamic'

const font = (f: string) => `family=${encodeURIComponent(f.trim()).replace(/%20/g, '+')}:wght@300;400;500;700`

/** Readable ink on a swatch. */
function inkOn(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const l = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
  return l > 150 ? '#141414' : '#fafafa'
}

/** A harmonized moodboard: the shared look (brief) and the tiles that show it in use. */
export default async function MoodboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await getHeaders() })
  if (!user) redirect(`/admin/login?redirect=${encodeURIComponent(`/library/moodboard/${id}`)}`)
  const mb: any = await payload.findByID({ collection: 'moodboards', id: Number(id), depth: 1, overrideAccess: true }).catch(() => null)
  if (!mb) notFound()
  const b: Brief = mb.brief
  const refs = await hydrate(payload, (b.source?.reference_ids ?? []).slice(0, 24).map((rid) => ({ id: rid, score: 0 })))
  const families = [b.typography.display, b.typography.text].filter(Boolean)
  const fontsHref = families.length ? `https://fonts.googleapis.com/css2?${families.map(font).join('&')}&display=swap` : null
  const base = b.palette.find((p) => /base|surface/i.test(p.role))?.hex ?? '#f4f1ea'
  const ink = b.palette.find((p) => /ink/i.test(p.role))?.hex ?? inkOn(base)
  const display = { fontFamily: `'${b.typography.display}', Georgia, serif` }
  const body = { fontFamily: `'${b.typography.text}', system-ui, sans-serif` }
  const tiles = (mb.tiles ?? []).filter((t: any) => t.image && typeof t.image === 'object')
  const planned = mb.status === 'brief' || !tiles.length
  const even = b.palette.length ? 100 / b.palette.length : 1

  return (
    <div className="mb" style={{ ['--mb-base' as any]: base, ['--mb-ink' as any]: ink, ...body }}>
      {fontsHref && <link rel="stylesheet" href={fontsHref} precedence="default" />}
      <nav className="mb-nav">
        <a href={`/library?board=${b.source.board_id}`}>← {b.source.board_name}</a>
        <span>
          Moodboard · {mb.status}
          {mb.cost ? ` · $${Number(mb.cost).toFixed(2)}` : ''}
        </span>
      </nav>

      <header className="mb-hero">
        <h1 style={display}>{b.name}</h1>
        <p className="mb-idea">{b.idea}</p>
        <ul className="mb-mood">
          {b.mood.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </header>

      <section className="mb-palette" aria-label="Palette">
        {b.palette.map((p) => (
          <div key={p.hex} className="mb-swatch" style={{ background: p.hex, color: inkOn(p.hex), flexGrow: p.share || even }}>
            <b>{p.name}</b>
            <span>{p.hex}</span>
            <span>
              {p.role}
              {p.share ? ` · ${p.share}%` : ''}
            </span>
          </div>
        ))}
      </section>

      <section className="mb-type">
        <div className="mb-type-display" style={display}>
          <span className="mb-aa">Aa</span>
          <div>
            <b>{b.typography.display}</b>
            <span>Display</span>
          </div>
        </div>
        <div className="mb-type-text">
          <p className="mb-type-feel" style={display}>
            {b.typography.feel}
          </p>
          <p>{b.typography.treatment}</p>
          <small>Text: {b.typography.text}</small>
        </div>
      </section>

      {planned ? (
        <section className="mb-plan">
          <h2 style={display}>Planned applications</h2>
          <ol>
            {b.applications.map((a) => (
              <li key={a.key}>
                <b>{a.title}</b>{' '}
                <em>
                  {a.category} · {a.aspect_ratio}
                </em>
                <p>{a.scene}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section className="mb-tiles">
          {tiles.map((t: any) => (
            <figure key={t.key}>
              <img src={t.image.variants?.large?.url ?? t.image.url} alt={t.title} loading="lazy" />
              <figcaption>{t.title}</figcaption>
            </figure>
          ))}
        </section>
      )}

      <section className="mb-rules">
        <div>
          <h3>Materials</h3>
          <ul>
            {b.materials.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Photography</h3>
          {Object.values(b.photography).map((v, k) => (
            <p key={k}>{v}</p>
          ))}
        </div>
        <div>
          <h3>Graphic language</h3>
          {Object.values(b.graphic_language).map((v, k) => (
            <p key={k}>{v}</p>
          ))}
        </div>
        <div>
          <h3>Do</h3>
          <ul>
            {b.do.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <h3>Avoid</h3>
          <ul>
            {b.dont.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      </section>

      {refs.length > 0 && (
        <section className="mb-source">
          <h3>Distilled from</h3>
          <div>
            {refs.map((r: any) => (
              <a key={r.id} href={`/library?ref=${r.id}`} title={r.description}>
                <img src={r.thumb ?? r.grid} alt="" loading="lazy" />
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
