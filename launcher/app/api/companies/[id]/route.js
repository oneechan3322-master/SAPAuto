import { db } from '../../../../lib/db.js'
import { requireRole, requireSameOrigin } from '../../../../lib/guard.js'
import { audit, now } from '../../../../../db/queries/shared.js'
import identity from '../../../../../domain/company-identity.cjs'

export async function PUT(request, { params }) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Operator')
  if (authz.response) return authz.response

  const { id } = await params
  const company = db.prepare('SELECT id,name,account_key,portal_name FROM companies WHERE id=?').get(id)
  if (!company) return Response.json({ error: 'لم نعثر على الشركة المطلوبة.' }, { status: 404 })

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'تعذر قراءة بيانات الشركة. أعد المحاولة.' }, { status: 400 })
  }
  const validated = identity.validateCompanyIdentity(body, company.account_key)
  if (validated.error) return Response.json({ error: validated.error }, { status: 400 })
  const nextIdentity = identity.resolveCompanyIdentity({
    ...company,
    name: validated.value.name,
    name_source: 'manual',
    english_name: validated.value.englishName,
    tax_registration_number: validated.value.taxRegistrationNumber
  })

  try {
    const saved = db.transaction(() => {
      db.prepare(`UPDATE companies SET name=?,english_name=?,tax_registration_number=?,
        name_source='manual',updated_at=? WHERE id=?`)
        .run(
          validated.value.name,
          validated.value.englishName,
          validated.value.taxRegistrationNumber,
          now(),
          company.id
        )
      audit(db, {
        actorId: authz.session.user.id,
        action: 'company.identity.updated',
        entityType: 'company',
        entityId: company.id,
        details: {
          nameOrigin: nextIdentity.origin,
          identityConflict: nextIdentity.origin === 'conflict',
          portalNamePresent: Boolean(company.portal_name),
          hasEnglishName: Boolean(validated.value.englishName),
          hasTaxRegistrationNumber: Boolean(validated.value.taxRegistrationNumber)
        }
      })
      return db.prepare(`SELECT id,name,english_name,tax_registration_number,name_source,account_key,portal_name,portal_name_english
        FROM companies WHERE id=?`).get(company.id)
    })()
    return Response.json({
      company: {
        ...saved,
        name_origin: identity.resolveCompanyIdentity(saved).origin
      }
    })
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return Response.json({ error: 'رقم التسجيل الضريبي مرتبط بشركة أخرى.' }, { status: 409 })
    }
    throw error
  }
}
