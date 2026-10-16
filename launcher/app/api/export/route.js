import { requireRole } from '../../../lib/guard.js'
import { getCompanyRecords, listRecords } from '../../../lib/data.js'
import { createExportWorkbook } from '../../../lib/export-workbook.js'

const sections = new Set([
  'companies', 'tasks', 'obligations', 'payments', 'messages',
  'failures', 'reminders', 'reports', 'audit', 'company'
])

export async function GET(request) {
  const authz = await requireRole(request, 'Viewer')
  if (authz.response) return authz.response

  const params = new URL(request.url).searchParams
  const section = params.get('section') || ''
  if (!sections.has(section)) return Response.json({ error: 'نوع القائمة غير صالح للتصدير.' }, { status: 400 })

  const fromDate = params.get('from') || ''
  const toDate = params.get('to') || ''
  if ((fromDate && !validDate(fromDate)) || (toDate && !validDate(toDate))) {
    return Response.json({ error: 'استخدم تاريخًا صحيحًا بصيغة سنة-شهر-يوم.' }, { status: 400 })
  }
  if (fromDate && toDate && fromDate > toDate) {
    return Response.json({ error: 'تاريخ البداية يجب أن يسبق تاريخ النهاية.' }, { status: 400 })
  }

  let rows
  let fileSection = section
  if (section === 'company') {
    const companyId = params.get('companyId') || ''
    const data = getCompanyRecords(companyId)
    if (!data) return Response.json({ error: 'لم نعثر على الشركة المطلوبة.' }, { status: 404 })
    const company = data.company
    rows = Object.entries(data.rows).flatMap(([kind, records]) => records.map((record) => ({
      ...record,
      section: kind,
      company_id: company.id,
      company_name: record.company_name,
      company_known: record.company_known,
      company_tax_registration_number: company.tax_registration_number
    })))
    fileSection = 'company'
  } else {
    rows = listRecords(section)
    if (section === 'companies') rows = rows.map((company) => ({
      ...company,
      section,
      company_id: company.id,
      company_name: company.name,
      company_known: company.company_known,
      company_tax_registration_number: company.tax_registration_number
    }))
    else rows = rows.map((row) => ({ ...row, section }))
  }

  const query = (params.get('q') || '').trim().slice(0, 160).toLocaleLowerCase()
  const currentCompany = params.get('company') || ''
  const selectedCompanies = params.getAll('companyId')
  rows = rows.filter((row) => {
    if (currentCompany === 'unknown' && row.company_known) return false
    if (currentCompany && currentCompany !== 'unknown' && row.company_id !== currentCompany) return false
    if (selectedCompanies.length && !selectedCompanies.some((selected) => (
      selected === 'unknown' ? !row.company_known : selected === row.company_id
    ))) return false
    if (query) {
      const companyText = [
        row.company_name,
        row.company_english_name,
        row.company_tax_registration_number
      ].join(' ').toLocaleLowerCase()
      if (!companyText.includes(query)) return false
    }
    if (section !== 'companies') {
      const itemDate = exportDate(row, section)
      if (fromDate && (!itemDate || itemDate < fromDate)) return false
      if (toDate && (!itemDate || itemDate > toDate)) return false
    }
    return true
  })

  const exportedAt = new Date()
  const workbook = await createExportWorkbook(rows, {
    source: `قاعدة بيانات SAPAuto المحلية · ${fileSection}`,
    exportedAt
  })
  const filename = makeFilename(rows, fileSection, exportedAt)
  return new Response(workbook, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'cache-control': 'no-store'
    }
  })
}

function exportDate(row, section) {
  const recordSection = row.section || section
  const value = recordSection === 'tasks' || recordSection === 'obligations'
    ? row.deadline
    : recordSection === 'payments'
      ? row.due_date
      : recordSection === 'messages'
        ? row.observed_at
        : recordSection === 'failures'
          ? row.occurred_at
          : section === 'reminders'
            ? row.due_at
            : row.created_at
  return typeof value === 'string' ? value.slice(0, 10) : ''
}

function makeFilename(rows, section, date) {
  const companyNames = [...new Set(rows.filter((row) => row.company_known).map((row) => row.company_name))]
  const label = companyNames.length === 1 ? companyNames[0] : section
  const dateKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
  return `SAPAuto_${slug(label)}_${slug(section)}_${dateKey}.xlsx`
}

function slug(value) {
  return String(value || 'Records').normalize('NFKC')
    .replace(/[^\p{L}\p{N}-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'Records'
}

function asciiFilename(value) {
  return value.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
