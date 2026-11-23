/** Google sign-in limited to the email domains in GOOGLE_ALLOWED_DOMAINS (comma separated). */

export const googleEnabled = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)

export const allowedDomains = () =>
  (process.env.GOOGLE_ALLOWED_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)

export const siteURL = (req: Request) => process.env.NEXT_PUBLIC_SERVER_URL || new URL(req.url).origin

export const callbackURL = (req: Request) => `${siteURL(req)}/api/auth/google/callback`

export const STATE_COOKIE = 'g_oauth_state'

/** Only same-site paths may be used as the post-login target. */
export const safeRedirect = (target: string | null | undefined) =>
  target && target.startsWith('/') && !target.startsWith('//') ? target : '/library'
