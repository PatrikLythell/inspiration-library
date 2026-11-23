import React from 'react'

import './library.css'

export const metadata = {
  title: 'Library',
  description: 'Team visual reference library',
}

export default function LibraryLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="lib-body">{children}</body>
    </html>
  )
}
