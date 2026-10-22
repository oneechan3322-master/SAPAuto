import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const nextConfig = {
  serverExternalPackages: ['better-sqlite3', 'pdfjs-dist', 'canvas', 'whatsapp-web.js'],
  outputFileTracingRoot: root,
  turbopack: { root },
  experimental: { agentUpgrade: 'security' }
}

export default nextConfig
