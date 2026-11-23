import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'

import { allowedDomains, callbackURL, googleEnabled, safeRedirect, STATE_COOKIE } from '@/auth/google'

/** GET /api/auth/google?redirect=/library — starts Google sign-in. */
export async function GET(req: Request) {
  if (!googleEnabled()) return NextResponse.json({ error: 'Google sign-in is not configured' }, { status: 404 })
  const url = new URL(req.url)
  const state = randomBytes(24).toString('base64url')
  const domains = allowedDomains()
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  auth.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!)
  auth.searchParams.set('redirect_uri', callbackURL(req))
  auth.searchParams.set('response_type', 'code')
  auth.searchParams.set('scope', 'openid email profile')
  auth.searchParams.set('state', state)
  auth.searchParams.set('prompt', 'select_account')
  // With one domain, Google shows only accounts from it; the server check below still applies.
  if (domains.length === 1) auth.searchParams.set('hd', domains[0])
  const res = NextResponse.redirect(auth)
  res.cookies.set(STATE_COOKIE, JSON.stringify({ state, redirect: safeRedirect(url.searchParams.get('redirect')) }), {
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'lax',
    path: '/api/auth/google',
    maxAge: 600,
  })
  return res
}
