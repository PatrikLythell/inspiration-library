import type { CollectionConfig } from 'payload'

import { searchEndpoint, similarEndpoint } from '../search/endpoints'

/**
 * One row per image. Brand and source are provenance only: people search by look,
 * mood, style and colour. The embedding column (halfvec) is added outside Payload's
 * field system in payload.config.ts (afterSchemaInit) and filled by the import/jobs.
 */
export const References: CollectionConfig = {
  slug: 'references',
  admin: {
    useAsTitle: 'sourceKey',
    defaultColumns: ['sourceKey', 'source', 'storage', 'status'],
    description: 'Visual references. Search and browse at /library.',
  },
  access: {
    read: ({ req }) => Boolean(req.user),
  },
  endpoints: [searchEndpoint, similarEndpoint],
  fields: [
    { name: 'sourceKey', type: 'text', required: true, unique: true, index: true },
    {
      name: 'source',
      type: 'select',
      required: true,
      index: true,
      options: ['brandarchive', 'visualjournal', 'creativeboom', 'upload'],
    },
    {
      name: 'storage',
      type: 'select',
      required: true,
      defaultValue: 'hosted',
      options: ['hosted', 'linked'],
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'active',
      index: true,
      options: ['active', 'hidden', 'duplicate', 'dead-link'],
    },
    { name: 'image', type: 'upload', relationTo: 'media' },
    {
      name: 'externalImage',
      type: 'group',
      admin: { condition: (data) => data?.storage === 'linked' },
      fields: [
        { name: 'thumb', type: 'text' },
        { name: 'small', type: 'text' },
        { name: 'large', type: 'text' },
        { name: 'original', type: 'text' },
        { name: 'width', type: 'number' },
        { name: 'height', type: 'number' },
      ],
    },
    { name: 'description', type: 'textarea' },
    {
      name: 'tags',
      type: 'json',
      admin: {
        description:
          'Controlled vocabulary: mood, style, medium, subject, composition, colour_character, era_reference, typography_style, keywords',
      },
    },
    {
      name: 'palette',
      type: 'json',
      admin: { description: '[{hex, name, lab: [L, a, b]}] largest area first' },
    },
    { name: 'dominantColor', type: 'text' },
    {
      name: 'provenance',
      type: 'group',
      fields: [
        { name: 'brand', type: 'text', index: true },
        { name: 'year', type: 'number' },
        { name: 'designers', type: 'json' },
        { name: 'sourceUrl', type: 'text' },
        { name: 'articleUrl', type: 'text' },
        { name: 'credit', type: 'text' },
      ],
    },
    {
      name: 'width',
      type: 'number',
      admin: { readOnly: true },
    },
    {
      name: 'height',
      type: 'number',
      admin: { readOnly: true },
    },
  ],
}
