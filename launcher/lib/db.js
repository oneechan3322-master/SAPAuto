import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
process.env.V8_ROOT ||= path.resolve(process.cwd(), '..')
require('dotenv').config({ path: path.join(process.env.V8_ROOT, '.env') })
const { getDatabase } = require('../../db/connect.js')
const { runMigrations } = require('../../db/migrate.js')

export const db = getDatabase()
runMigrations(db, path.join(process.env.V8_ROOT, 'db', 'migrations'))
