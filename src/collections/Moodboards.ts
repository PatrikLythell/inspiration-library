import type { CollectionConfig } from 'payload'

const signedIn = ({ req }: { req: { user?: unknown } }) => Boolean(req.user)

/**
 * Harmonized moodboards made from a board: one shared look (the brief) shown across a range of
 * applications. Generated tiles live here, not in references, so they never mix with real
 * references in search.
 */
export const Moodboards: CollectionConfig = {
  slug: 'moodboards',
  versions: false,
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'board', 'status', 'updatedAt'] },
  access: { read: signedIn, create: signedIn, update: signedIn, delete: signedIn },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'board', type: 'relationship', relationTo: 'boards', index: true },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'brief',
      options: ['brief', 'generating', 'done', 'failed'],
    },
    { name: 'brief', type: 'json', required: true },
    { name: 'model', type: 'text' },
    { name: 'cost', type: 'number', admin: { description: 'USD spent on images so far' } },
    {
      name: 'tiles',
      type: 'array',
      fields: [
        { name: 'key', type: 'text' },
        { name: 'title', type: 'text' },
        { name: 'prompt', type: 'textarea' },
        { name: 'image', type: 'upload', relationTo: 'media' },
        { name: 'error', type: 'text' },
      ],
    },
    { name: 'owner', type: 'relationship', relationTo: 'users' },
  ],
}
