import config from '@payload-config'
import { oauthProtectedResourceHandler } from '@payloadcms/plugin-mcp'

// For MCP clients that look for OAuth metadata at the site root instead of following the challenge link.
export const GET = oauthProtectedResourceHandler({ config })
