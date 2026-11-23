import config from '@payload-config'
import { headers as getHeaders } from 'next/headers.js'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import { Library } from './Library'

export const dynamic = 'force-dynamic'

/** Eagle-like browsing view for signed-in team members. */
export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await getHeaders() })
  if (!user) redirect('/admin/login?redirect=%2Flibrary')
  const { ref } = await searchParams
  return <Library initialRef={ref ? Number(ref) : undefined} />
}
