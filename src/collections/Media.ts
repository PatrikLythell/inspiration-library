import type { CollectionConfig } from 'payload'

import { createFolderField, createTagField } from 'payload'

/** Hosted reference images. Grid and lightbox use the generated sizes; originals are kept. */
export const Media: CollectionConfig = {
  slug: 'media',
  versions: false,
  access: {
    read: ({ req }) => Boolean(req.user) || process.env.PUBLIC_MEDIA === 'true',
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
    },
    createFolderField({ relationTo: 'folders' }),
    createTagField({ relationTo: 'tags' }),
  ],
  upload: {
    mimeTypes: ['image/*'],
  },
}
