import { isIP } from 'node:net'

function loopback(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '::1' ||
    (isIP(host) === 4 && Number(host.split('.')[0]) === 127)
}

export function localControlError(request, { mutation = false } = {}) {
  const host = request.headers.get('host') || ''
  let hostUrl
  try { hostUrl = new URL(`http://${host}`) }
  catch { return Response.json({ error: 'Local dashboard access only' }, { status: 403 }) }
  if (!loopback(hostUrl.hostname)) {
    return Response.json({ error: 'Local dashboard access only' }, { status: 403 })
  }
  if (!mutation) return null

  const origin = request.headers.get('origin')
  if (!origin) return Response.json({ error: 'Origin header is required' }, { status: 403 })
  try {
    const originUrl = new URL(origin)
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0].trim()
      || new URL(request.url).protocol.replace(/:$/, '')
    const expected = new URL(`${protocol}://${host}`)
    if (!loopback(originUrl.hostname) || originUrl.origin !== expected.origin) {
      return Response.json({ error: 'Cross-origin request rejected' }, { status: 403 })
    }
  } catch {
    return Response.json({ error: 'Invalid request origin' }, { status: 403 })
  }
  return null
}
