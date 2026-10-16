import { db } from '../../../../lib/db.js'
import { requireRole, requireSameOrigin } from '../../../../lib/guard.js'
import { audit, now } from '../../../../../db/queries/shared.js'
import identity from '../../../../../domain/company-identity.cjs'

const recordTables = {
  failures: 'failures',
  reminders: 'reminders',
  reports: 'reports'
}

export async function PUT(request) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Operator')
  if (authz.response) return authz.response

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'تعذر قراءة طلب الربط. أعد المحاولة.' }, { status: 400 })
  }

  const table = Object.hasOwn(recordTables, body?.section) ? recordTables[body.section] : null
  const recordId = typeof body?.recordId === 'string' ? body.recordId.trim() : ''
  const companyId = typeof body?.companyId === 'string' ? body.companyId.trim() : ''
  if (!table || !recordId || recordId.length > 200 || !companyId || companyId.length > 200) {
    return Response.json({ error: 'اختر سجلًا وشركة صالحين للربط.' }, { status: 400 })
  }

  const storedCompany = db.prepare(`SELECT id,name,account_key,name_source,english_name,portal_name
    FROM companies WHERE id=?`).get(companyId)
  if (!storedCompany) return Response.json({ error: 'لم نعثر على الشركة المطلوبة.' }, { status: 404 })
  const company = identity.resolveCompanyIdentity(storedCompany)
  if (!company.known) {
    return Response.json({ error: 'أكمل اسم الشركة أولًا قبل ربط السجلات بها.' }, { status: 409 })
  }

  const record = db.prepare(`SELECT id,company_id FROM ${table} WHERE id=?`).get(recordId)
  if (!record) return Response.json({ error: 'لم نعثر على السجل المطلوب.' }, { status: 404 })
  if (table === 'reminders') {
    const reminder = db.prepare('SELECT target_type,target_id FROM reminders WHERE id=?').get(recordId)
    const targetTables = { task: 'tasks', obligation: 'obligations', payment: 'payments' }
    const targetTable = targetTables[reminder.target_type]
    const target = targetTable
      ? db.prepare(`SELECT company_id FROM ${targetTable} WHERE id=?`).get(reminder.target_id)
      : null
    if (target?.company_id) {
      return Response.json({ error: 'هذه المذكرة مرتبطة بشركة السجل الأصلي، ولن نغيّر هذا الارتباط يدويًا.' }, { status: 409 })
    }
  }

  db.transaction(() => {
    db.prepare(`UPDATE ${table} SET company_id=? WHERE id=?`).run(company.id, recordId)
    audit(db, {
      actorId: authz.session.user.id,
      action: 'record.company_linked',
      entityType: table,
      entityId: recordId,
      details: { companyId: company.id }
    })
  })()

  return Response.json({ success: true, companyName: company.name })
}
