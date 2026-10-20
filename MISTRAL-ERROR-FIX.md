# Mistral Error Fix

## Error Seen in UI
Status: error
Time: 11:41 م ١٩/١٠/٢٠٢٦

## Root Cause
HTTP 429 - Rate limit exceeded
Primary API key: mstrl_hqBOCR2cu... (redacted — revoke per Opus5.5 plan, Phase 0)

## Solution Options

### 1. Switch to Secondary Key
Update .env:
MISTRAL_API_KEY=mstrl_rHpH0pqHr... (redacted — revoke per Opus5.5 plan, Phase 0)

### 2. Use Local Gemma 4 Instead
Default provider (no rate limits):
AI_PROVIDER=gemma4
AI_ALLOW_CLOUD=false

### 3. Wait for Rate Limit Reset
Mistral free tier resets daily/hourly

## Recommended
Use Gemma 4 for daily operations, enable Mistral only when needed:
- Gemma 4: Local, fast, no limits
- Mistral: Cloud, for complex analysis only

