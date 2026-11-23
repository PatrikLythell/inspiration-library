import config from '@payload-config'
import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import { allowedDomains, callbackURL, googleEnabled, siteURL, STATE_COOKIE } from '@/auth/google'

const fail = (req: Request, reason: string) =>
  NextResponse.redirect(`${siteURL(req)}/admin/login?error=${encodeURIComponent(reason)}`)

/** GET /api/auth/google/callback — finishes Google sign-in and starts a normal Payload session. */
export async function GET(req: Request) {
  if (!googleEnabled()) return fail(req, 'Google sign-in is not configured')
  const url = new URL(req.url)
  const cookie = req.headers
    .get('cookie')
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${STATE_COOKIE}=`))
  let saved: { state: string; redirect: string } | null = null
  try {
    saved = cookie ? JSON.parse(decodeURIComponent(cookie.slice(STATE_COOKIE.length + 1))) : null
  } catch {
    saved = null
  }
  if (!saved || saved.state !== url.searchParams.get('state')) return fail(req, 'Sign-in expired, please try again')
  const code = url.searchParams.get('code')
  if (!code) return fail(req, 'Google sign-in was cancelled')

  // Exchange the code directly with Google over TLS; the returned ID token is trusted as issued to us.
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: callbackURL(req),
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenRes.ok) return fail(req, 'Google sign-in failed')
  const { id_token } = (await tokenRes.json()) as { id_token?: string }
  const claims = id_token ? JSON.parse(Buffer.from(id_token.split('.')[1], 'base64url').toString()) : null
  const email = String(claims?.email ?? '').toLowerCase()
  if (!claims || claims.aud !== process.env.GOOGLE_CLIENT_ID || !claims.email_verified || !email) {
    return fail(req, 'Google did not confirm your email')
  }
  const domain = email.split('@')[1]
  if (!allowedDomains().includes(domain)) return fail(req, `${domain} is not allowed in this library`)

  const payload = await getPayload({ config })
  // Each Google sign-in sets a fresh random password, so the account can only be entered through Google.
  const password = randomBytes(32).toString('base64url')
  const { docs } = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
  })
  if (docs[0]) {
    await payload.update({ collection: 'users', id: docs[0].id, data: { password }, overrideAccess: true })
  } else {
    await payload.create({ collection: 'users', data: { email, password }, overrideAccess: true })
  }
  const login = await payload.login({ collection: 'users', data: { email, password }, overrideAccess: true })
  const res = NextResponse.redirect(`${siteURL(req)}${saved.redirect}`)
  res.cookies.set(`${payload.config.cookiePrefix}-token`, login.token!, {
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    expires: login.exp ? new Date(login.exp * 1000) : undefined,
  })
  res.cookies.delete({ name: STATE_COOKIE, path: '/api/auth/google' })
  return res
}
