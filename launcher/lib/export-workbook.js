import ExcelJS from 'exceljs'
import identity from '../../domain/company-identity.cjs'

const HEADERS = [
  'الشركة',
  'رقم التسجيل الضريبي',
  'عنوان العنصر',
  'الحالة',
  'الموعد',
  'المبلغ',
  'العملة',
  'آخر مزامنة'
]

const ARABIC_HEADERS = ['الشركة', 'الحالة', 'العملة', 'عدد العناصر', 'إجمالي المبلغ']

export async function createExportWorkbook(records, { source, exportedAt = new Date() } = {}) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'SAPAuto V8'
  workbook.created = exportedAt
  workbook.modified = exportedAt
  workbook.subject = 'تصدير سجلات SAPAuto المحلية'
  workbook.title = 'تصدير SAPAuto'

  const details = records.map(normalizeRecord)
  const groups = new Map()
  for (const record of details) {
    const groupKey = record.companyId || `unknown:${record.companyName}`
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey).push(record)
  }

  const summaryRows = summarize(details)
  const summarySheet = workbook.addWorksheet('Summary', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] })
  addTable(summarySheet, ARABIC_HEADERS, summaryRows.map((row) => [
    row.companyName,
    row.status,
    row.currency,
    row.count,
    row.amount
  ]), { amountColumn: 5, currencyColumn: 3 })

  const detailsSheet = workbook.addWorksheet('Details', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] })
  addTable(detailsSheet, HEADERS, details.map(toWorksheetRow), { amountColumn: 6, currencyColumn: 7 })

  const nameCounts = new Map()
  for (const group of groups.values()) {
    const rawName = group[0].companyKnown ? group[0].companyName : identity.UNREGISTERED_COMPANY_NAME
    const occurrence = (nameCounts.get(rawName) || 0) + 1
    nameCounts.set(rawName, occurrence)
    const sheetName = safeSheetName(occurrence === 1 ? rawName : `${rawName} ${occurrence}`)
    const sheet = workbook.addWorksheet(sheetName, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] })
    addTable(sheet, HEADERS, group.map(toWorksheetRow), { amountColumn: 6, currencyColumn: 7 })
  }

  const metadata = workbook.addWorksheet('Metadata', { views: [{ rightToLeft: true }] })
  metadata.addRows([
    ['تاريخ التصدير', exportedAt],
    ['مصدر البيانات', safeExcelText(source || 'قاعدة بيانات SAPAuto المحلية')],
    ['عدد السجلات', details.length]
  ])
  metadata.getColumn(1).width = 24
  metadata.getColumn(2).width = 48
  metadata.getCell('A1').numFmt = 'dd mmmm yyyy hh:mm'
  for (const row of metadata.getRows(1, 3) || []) {
    row.getCell(1).font = { bold: true, color: { argb: 'FFBFA879' } }
    row.eachCell((cell) => { cell.alignment = { vertical: 'middle', wrapText: true } })
  }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

function normalizeRecord(record) {
  const companyName = stringValue(record.company_name || record.name) || identity.UNREGISTERED_COMPANY_NAME
  const companyKnown = Boolean(record.company_known)
  const rawAmount = record.amount
  const amount = rawAmount === null || rawAmount === undefined || rawAmount === ''
    ? null
    : Number(rawAmount)
  return {
    companyId: stringValue(record.company_id),
    companyName,
    companyKnown,
    taxRegistrationNumber: stringValue(
      record.company_tax_registration_number || record.tax_registration_number
    ),
    title: stringValue(
      record.title || record.message || record.reason || record.required_action
      || (record.section === 'companies' ? companyName : '')
    ) || 'لم يتم تسجيل عنوان العنصر',
    status: exportStatus(record),
    dueDate: parseDate(record.due_date || record.deadline || record.due_at || record.observed_at || record.occurred_at || record.created_at),
    amount: Number.isFinite(amount) ? amount : null,
    currency: stringValue(record.currency),
    lastSynced: parseDate(record.company_last_synced_at)
  }
}

function exportStatus(record) {
  if (record.section === 'failures') return record.resolved_at ? 'تم حلها' : 'تحتاج إلى مراجعة'
  if (record.section === 'companies') {
    return record.last_scan_state === 'failed' || record.last_scan_state === 'parked'
      ? 'تعذرت المزامنة'
      : record.last_scan_state === 'scanning'
        ? 'تجري المزامنة'
        : record.last_scan_state === 'ready'
          ? 'تمت المزامنة'
          : 'حالة المزامنة غير متاحة'
  }
  const raw = stringValue(record.source_status ?? record.status ?? record.severity).toLocaleLowerCase()
  const labels = {
    open: 'قيد المتابعة',
    pending: 'قيد المتابعة',
    in_progress: 'قيد المتابعة',
    'in progress': 'قيد المتابعة',
    done: 'مكتمل',
    complete: 'مكتمل',
    completed: 'مكتمل',
    resolved: 'تمت المعالجة',
    paid: 'تم السداد وفق السجل',
    overdue: 'تجاوز الموعد المسجل',
    due_soon: 'موعد قريب',
    payment_due: 'موعد الدفع',
    not_late: 'لم يحن موعد الدفع',
    unknown: 'الحالة غير معروفة في المصدر',
    info: 'للعلم',
    warning: 'للمراجعة',
    critical: 'تحتاج انتباهًا',
    error: 'تعذرت المعالجة'
  }
  return labels[raw] || stringValue(record.source_status ?? record.status ?? record.severity) || 'لم يتم تسجيل الحالة'
}

function summarize(records) {
  const totals = new Map()
  for (const record of records) {
    const key = `${record.companyId}\u0000${record.status}\u0000${record.currency}`
    const current = totals.get(key) || {
      companyName: record.companyName,
      status: record.status,
      currency: record.currency,
      count: 0,
      amount: null
    }
    current.count += 1
    if (record.amount !== null) current.amount = (current.amount || 0) + record.amount
    totals.set(key, current)
  }
  return [...totals.values()]
}

function toWorksheetRow(record) {
  return [
    safeExcelText(record.companyName),
    safeExcelText(record.taxRegistrationNumber),
    safeExcelText(record.title),
    safeExcelText(record.status),
    record.dueDate,
    record.amount,
    safeExcelText(record.currency),
    record.lastSynced
  ]
}

function addTable(sheet, headers, rows, { amountColumn, currencyColumn }) {
  sheet.addRow(headers.map(safeExcelText))
  for (const values of rows) sheet.addRow(values)
  sheet.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: `${columnName(headers.length)}${sheet.rowCount}` }
  sheet.getRow(1).height = 32
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFF4F1E8' } }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B493F' } }
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }

  for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex)
    row.height = 26
    row.alignment = { vertical: 'middle', wrapText: true }
    if (rowIndex % 2 === 0) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F5F3' } }
    }
    if (headers.length === HEADERS.length) {
      row.getCell(2).numFmt = '@'
      row.getCell(5).numFmt = 'dd mmmm yyyy hh:mm'
      row.getCell(8).numFmt = 'dd mmmm yyyy hh:mm'
    }
    if (amountColumn) {
      const amount = row.getCell(amountColumn).value
      const currency = stringValue(row.getCell(currencyColumn).value)
      row.getCell(amountColumn).numFmt = amountFormat(amount, currency)
    }
  }

  function amountFormat(value, currency) {
    const decimal = typeof value === 'number' ? String(value).split('.')[1]?.length || 0 : 2
    const precision = Math.min(12, Math.max(2, decimal))
    const fraction = '0'.repeat(2) + '#'.repeat(precision - 2)
    const suffix = /^[A-Z]{3}$/.test(currency) ? ` "${currency}"` : ''
    return `#,##0.${fraction}${suffix}`
  }

  headers.forEach((header, index) => {
    const maxContent = Math.max(
      String(header).length,
      ...rows.map((row) => String(row[index] ?? '').length)
    )
    sheet.getColumn(index + 1).width = Math.min(48, Math.max(14, maxContent + 3))
  })
}

function parseDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string' || !value.trim()) return null
  const input = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [year, month, day] = input.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day, 12))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
    return date
  }
  const parsed = new Date(input)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function stringValue(value) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : ''
}

function safeExcelText(value) {
  const text = stringValue(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

function columnName(number) {
  let n = number
  let name = ''
  while (n > 0) {
    const remainder = (n - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

function safeSheetName(value) {
  return value.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31).trim() || 'Company'
}
