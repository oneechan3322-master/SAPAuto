# SAPAuto V8 - Channel Improvements Specification

## Feature 1: Mistral API Key Rotation

### Current State
- System has MISTRAL_API_KEYS defined but only uses first key
- When rate-limited, requests fail immediately
- No automatic fallback to secondary keys

### Proposed Changes

#### 1.1 Update assistant/model.js
\\\javascript
async function chatMistral(messages, tools) {
  // ... existing checks ...
  
  // Get all available keys
  const allKeys = (process.env.MISTRAL_API_KEYS || process.env.MISTRAL_API_KEY || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)
  
  if (allKeys.length === 0) {
    throw new Error('MISTRAL_API_KEY is required when AI_PROVIDER=mistral')
  }
  
  // Try each key until one works
  let lastError = null
  for (const [index, apiKey] of allKeys.entries()) {
    try {
      const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: \Bearer \\,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
          messages,
          tools,
          ...(tools.length ? { tool_choice: 'auto' } : {})
        }),
        signal: AbortSignal.timeout(120000),
        redirect: 'error'
      })
      
      // If rate limited (429), try next key
      if (response.status === 429) {
        console.log(\Mistral key \/\ rate-limited, trying next...\)
        lastError = new Error(\Key \ rate-limited\)
        continue
      }
      
      if (!response.ok) {
        throw new Error(\Mistral returned HTTP \\)
      }
      
      const result = await response.json()
      const message = result.choices && result.choices[0] && result.choices[0].message
      if (!message) throw new Error('Mistral returned an invalid chat response')
      
      // Success! Return result
      return { content: message.content || '', toolCalls: normalizeToolCalls(message.tool_calls) }
      
    } catch (error) {
      lastError = error
      // If not rate limit error, don't try other keys
      if (!error.message.includes('429') && !error.message.includes('rate')) {
        throw error
      }
    }
  }
  
  // All keys failed
  throw new Error(\All \ Mistral API keys are rate-limited. Try again later or use Gemma 4 (AI_PROVIDER=gemma4)\)
}
\\\

### Testing
- Add multiple keys to .env
- Trigger rate limit on first key
- Verify automatic fallback to second key
- UI should show rotation status

---

## Feature 2: Gmail OAuth Integration

### Current State
- Uses app passwords (less secure, requires 2FA)
- UI shows "غير مربط" (not linked)
- No OAuth flow

### Proposed Changes

#### 2.1 Add OAuth dependencies
\\\ash
npm install googleapis@latest --save
\\\

#### 2.2 Create Gmail OAuth module
File: \channels/gmail-oauth.js\

\\\javascript
const { google } = require('googleapis')
const { getDatabase } = require('../db/connect')

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly'
]

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/api/auth/gmail/callback'
  )
}

function getAuthUrl() {
  const oauth2Client = getOAuth2Client()
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  })
}

async function handleCallback(code) {
  const oauth2Client = getOAuth2Client()
  const { tokens } = await oauth2Client.getToken(code)
  
  // Store tokens in database
  const db = getDatabase()
  const timestamp = new Date().toISOString()
  db.prepare(\
    INSERT INTO settings(key, value, updated_at)
    VALUES('gmail_oauth_tokens', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  \).run(JSON.stringify(tokens), timestamp)
  
  return tokens
}

function getStoredTokens() {
  const db = getDatabase()
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get('gmail_oauth_tokens')
  return row ? JSON.parse(row.value) : null
}

async function getGmailClient() {
  const tokens = getStoredTokens()
  if (!tokens) throw new Error('Gmail not authenticated. Complete OAuth flow first.')
  
  const oauth2Client = getOAuth2Client()
  oauth2Client.setCredentials(tokens)
  
  return google.gmail({ version: 'v1', auth: oauth2Client })
}

module.exports = {
  getAuthUrl,
  handleCallback,
  getGmailClient,
  getStoredTokens
}
\\\

#### 2.3 Add OAuth routes
File: \launcher/app/api/auth/gmail/route.js\

\\\javascript
import { getAuthUrl, handleCallback } from '../../../../../channels/gmail-oauth.js'
import { requireRole } from '../../../../lib/guard.js'

export async function GET(request) {
  const authz = await requireRole(request, 'Owner')
  if (authz.response) return authz.response
  
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  
  if (code) {
    // Handle callback
    try {
      await handleCallback(code)
      return Response.redirect(new URL('/settings?gmail=success', url.origin))
    } catch (error) {
      return Response.redirect(new URL(\/settings?gmail=error&msg=\\, url.origin))
    }
  }
  
  // Start OAuth flow
  const authUrl = getAuthUrl()
  return Response.redirect(authUrl)
}
\\\

#### 2.4 Update Gmail channel to use OAuth
Update \channels/gmail.js\:
- Check for OAuth tokens first
- Fall back to app password if OAuth not configured
- Use \getGmailClient()\ for OAuth-based operations

#### 2.5 Add UI button
File: \launcher/components/channels-view.jsx\ (or similar)

\\\jsx
<button
  onClick={() => window.location.href = '/api/auth/gmail'}
  className="btn-primary"
>
  {gmailLinked ? 'إعادة ربط Gmail' : 'ارب ط بريدك'}
</button>
\\\

### Environment Variables
Add to \.env.example\:
\\\
GMAIL_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REDIRECT_URI=http://localhost:3000/api/auth/gmail/callback
\\\

### Setup Instructions
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project or use existing
3. Enable Gmail API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI: \http://localhost:3000/api/auth/gmail/callback\
6. Copy Client ID and Secret to .env

---

## Implementation Priority

### Phase 1 (Immediate) - Mistral Key Rotation
- ✅ Already coded above
- Low risk, high value
- Estimated time: 30 minutes

### Phase 2 (Next Session) - Gmail OAuth
- Requires Google Cloud setup
- More complex but better UX
- Estimated time: 2 hours

---

## Testing Checklist

### Mistral Rotation
- [ ] Multiple keys in .env
- [ ] First key rate-limited
- [ ] Automatic fallback works
- [ ] UI shows which key is active
- [ ] All keys exhausted shows proper error

### Gmail OAuth
- [ ] Auth flow initiates
- [ ] Callback receives tokens
- [ ] Tokens stored securely
- [ ] Email sending works
- [ ] Token refresh works
- [ ] Fallback to app password

