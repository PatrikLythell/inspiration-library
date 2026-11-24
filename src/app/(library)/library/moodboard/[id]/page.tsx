import config from '@payload-config'
import { headers as getHeaders } from 'next/headers.js'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import type { Brief } from '../../../../../moodboard/brief'
import { justifiedLayout } from '../../../../../moodboard/layout'
import '../moodboard.css'

export const dynamic = 'force-dynamic'

/**
 * A moodboard as an artboard: the direction's name and its images, nothing else. The brief
 * (palette, materials, plan) is working material behind the images and stays off the board.
 */
export default async function MoodboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await getHeaders() })
  if (!user) redirect(`/admin/login?redirect=${encodeURIComponent(`/library/moodboard/${id}`)}`)
  const mb: any = await payload.findByID({ collection: 'moodboards', id: Number(id), depth: 1, overrideAccess: true }).catch(() => null)
  if (!mb) notFound()
  const b: Brief = mb.brief
  const imgs = (mb.tiles ?? [])
    .filter((t: any) => typeof t.image === 'object' && t.image?.url)
    .map((t: any) => ({ key: t.key, url: t.image.variants?.large?.url ?? t.image.url, width: t.image.width ?? 1, height: t.image.height ?? 1 }))
  const board = justifiedLayout(imgs)
  const planned = !imgs.length

  return (
    <div className="mb">
      <nav className="mb-nav">
        <a href={`/library?board=${b.source.board_id}`}>← {b.source.board_name}</a>
        <span>
          {mb.status}
          {mb.cost ? ` · $${Number(mb.cost).toFixed(2)}` : ''}
        </span>
      </nav>
      <h1 className="mb-title">{mb.name}</h1>
      {planned ? (
        <ol className="mb-plan">
          {b.applications.map((a) => (
            <li key={a.key}>
              <b>{a.title}</b> <em>{a.tier}</em>
              <p>{a.scene}</p>
            </li>
          ))}
        </ol>
      ) : (
        <div className="mb-board" style={{ aspectRatio: `${board.width} / ${board.height}` }}>
          {board.images.map((im) => (
            <img
              key={im.key}
              src={im.url}
              alt={im.key.replace(/-/g, ' ')}
              style={{
                left: `${(im.x / board.width) * 100}%`,
                top: `${(im.y / board.height) * 100}%`,
                width: `${(im.width / board.width) * 100}%`,
                height: `${(im.height / board.height) * 100}%`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
