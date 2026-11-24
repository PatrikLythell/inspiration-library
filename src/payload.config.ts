import { postgresAdapter } from '@payloadcms/db-postgres'
import { halfvec, index } from '@payloadcms/db-postgres/drizzle/pg-core'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { vercelBlobStorage } from '@payloadcms/storage-vercel-blob'
import { sharpTransformer } from '@payloadcms/transformer-sharp'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { Boards } from './collections/Boards'
import { Moodboards } from './collections/Moodboards'
import { Folders } from './collections/Folders'
import { Media } from './collections/Media'
import { References } from './collections/References'
import { Tags } from './collections/Tags'
import { Users } from './collections/Users'
import { migrations } from './migrations'
import { referenceTools } from './mcp/tools'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

/** Built-in CRUD tools are switched off so assistants only see the reference capability. */
const BUILTINS = [
  'count',
  'countVersions',
  'create',
  'delete',
  'duplicate',
  'find',
  'findDistinct',
  'findVersionByID',
  'findVersions',
  'getCollectionSchema',
  'getUploadInstructions',
  'restoreVersion',
  'update',
  'auth',
  'forgotPassword',
  'login',
  'resetPassword',
  'unlock',
  'verify',
] as const
const noBuiltins = { tools: Object.fromEntries(BUILTINS.map((k) => [k, false])) } as any

export default buildConfig({
  admin: {
    user: Users.slug,
    components: {
      // Shown only when GOOGLE_CLIENT_ID/SECRET are set.
      afterLogin: process.env.GOOGLE_CLIENT_ID ? ['@/components/GoogleLogin'] : [],
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [References, Boards, Moodboards, Media, Users, Folders, Tags],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  serverURL: process.env.NEXT_PUBLIC_SERVER_URL || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
      max: Number(process.env.DB_POOL_MAX ?? 5),
    },
    extensions: ['vector'],
    // Schema changes ship as migrations; they run on cold start in production.
    prodMigrations: migrations,
    afterSchemaInit: [
      ({ schema, extendTable }) => {
        // Image vectors (google/gemini-embedding-2). halfvec keeps 3,072 dims indexable by HNSW;
        // embedding_1536 is the truncated, re-normalised variant tested in P0.
        extendTable({
          table: schema.tables.references,
          columns: {
            embedding: halfvec('embedding', { dimensions: 3072 }),
            embedding_1536: halfvec('embedding_1536', { dimensions: 1536 }),
          },
          extraConfig: (t: any) => ({
            references_embedding_hnsw: index('references_embedding_hnsw')
              .using('hnsw', t.embedding.op('halfvec_cosine_ops')),
            references_embedding_1536_hnsw: index('references_embedding_1536_hnsw')
              .using('hnsw', t.embedding_1536.op('halfvec_cosine_ops')),
          }),
        })
        return schema
      },
    ],
  }),
  storage: [
    vercelBlobStorage({
      enabled: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      // Images are served straight from the Blob CDN (fast grid, previews readable by MCP clients).
      collections: { media: { disablePayloadAccessControl: true } },
      token: process.env.BLOB_READ_WRITE_TOKEN,
      clientUploads: true,
    }),
  ],
  plugins: [
    mcpPlugin({
      collections: {
        references: noBuiltins,
        boards: noBuiltins,
        moodboards: noBuiltins,
        media: noBuiltins,
        users: noBuiltins,
        folders: noBuiltins,
        tags: noBuiltins,
      },
      tools: referenceTools,
    }),
  ],
  upload: {
    transformers: [
      sharpTransformer({
        collections: {
          media: {
            // Grid and lightbox renditions; the original file is kept.
            variants: [
              { name: 'thumb', width: 400, formatOptions: { format: 'webp', options: { quality: 75 } } },
              { name: 'grid', width: 640, formatOptions: { format: 'webp', options: { quality: 80 } } },
              { name: 'large', width: 1600, withoutEnlargement: true, formatOptions: { format: 'webp', options: { quality: 82 } } },
            ],
          },
        },
      }),
    ],
  },
})
