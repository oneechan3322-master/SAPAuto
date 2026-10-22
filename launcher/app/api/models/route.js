import { createRequire } from 'node:module'
import { requireRole, requireSameOrigin } from '../../../lib/guard.js'

const require = createRequire(import.meta.url)
const { getDatabase } = require('../../../../db/connect')
const { audit } = require('../../../../db/queries/shared')
const modelCenter = require('../../../../lib/model-center')

export async function GET(request) {
  const authz = await requireRole(request, 'Viewer')
  if (authz.response) return authz.response
  try {
    return Response.json(modelCenter.listState(getDatabase()))
  } catch (error) {
    return Response.json({ error: `فشل قراءة حالة النماذج: ${String(error.message || error).slice(0, 200)}` }, { status: 500 })
  }
}

// POST — Model Center actions, Owner only, all audited:
//   select   { file }              → survives without a restart (applies via 'apply')
//   apply    {}                    → pm2 restart sapauto-v8-local-model (the only
//                                    dashboard-driven service restart, by design)
//   download { url, file }         → detached GGUF downloader with live progress
//   cancel-download {}             → the child finishes its tick and stops
//   bench    {}                    → scripts/bench-models.js in the background
//                                    (runs only when llama-server + RAM allow)
export async function POST(request) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Owner')
  if (authz.response) return authz.response
  let body
  try { body = await request.json() } catch {
    return Response.json({ error: 'طلب غير صالح' }, { status: 400 })
  }
  const db = getDatabase()
  const trace = (entityId, details = {}) => audit(db, {
    actorId: authz.session.user.id,
    action: `model_center.${body?.action}`,
    entityType: 'model',
    entityId,
    details
  })
  try {
    switch (body?.action) {
      case 'select': {
        const result = modelCenter.selectModel(db, body)
        if (result.error) return Response.json({ error: result.error }, { status: 400 })
        trace(body.file, { appliedLaterByChoice: true })
        return Response.json({ saved: true, ...result })
      }
      case 'apply': {
        const result = await modelCenter.applyModel(db)
        trace(result.selected, { applied: result.applied, error: result.error || null })
        return Response.json(result, { status: result.applied ? 200 : 502 })
      }
      case 'download': {
        const result = modelCenter.startDownload(db, body)
        if (result.error) return Response.json({ error: result.error }, { status: 400 })
        trace(result.file, { source: result.url })
        return Response.json({ started: true, ...result })
      }
      case 'cancel-download': {
        const result = modelCenter.requestCancel(db)
        if (result.error) return Response.json({ error: result.error }, { status: 400 })
        trace('download', {})
        return Response.json({ ...result })
      }
      case 'bench': {
        const result = modelCenter.startBench(db)
        trace('bench', {})
        return Response.json({ ...result })
      }
      default:
        return Response.json({ error: 'إجراء غير معروف' }, { status: 400 })
    }
  } catch (error) {
    console.error(`[model-center POST] ${error.message}`)
    return Response.json({ error: 'تعذر تنفيذ إجراء النماذج.' }, { status: 500 })
  }
}
