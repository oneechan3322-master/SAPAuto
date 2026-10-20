import { betterAuth } from 'better-auth'
import { db } from './db.js'

const secret = process.env.V8_SESSION_SECRET
if (process.env.NODE_ENV === 'production' && (!secret || secret.length < 32)) {
  throw new Error('V8_SESSION_SECRET must contain at least 32 characters in production')
}

export const auth = betterAuth({
  database: db,
  secret: secret || 'development-only-secret-change-before-install-32chars',
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  trustedOrigins: (process.env.V8_TRUSTED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://192.168.1.111:3000,http://26.182.57.137:3000')
    .split(',').map((origin) => origin.trim()).filter(Boolean),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 12,
    maxPasswordLength: 128
  },
  user: {
    modelName: 'users',
    additionalFields: {
      role: { type: 'string', required: true, defaultValue: 'Viewer', input: false },
      disabled: { type: 'boolean', required: true, defaultValue: false, input: false }
    }
  },
  session: {
    modelName: 'sessions',
    expiresIn: 60 * 60 * 12,
    updateAge: 60 * 60
  },
  account: { modelName: 'user_accounts' },
  verification: { modelName: 'verification' },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === 'production' &&
      (process.env.BETTER_AUTH_URL || '').startsWith('https://'),
    database: { generateId: 'uuid' }
  }
})
