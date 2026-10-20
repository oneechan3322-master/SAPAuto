'use strict'
const fs = require('node:fs')
const { getDatabase } = require('../db/connect')
const { extractPdfText } = require('../assistant/pdf-reader.cjs')
const db = getDatabase()

function parseOfficialPdfDetails(pdfText, task, db) {
  const text = String(pdfText || '')
  let officialTitle = ''
  let company = ''
  let refNumber = ''

  // 1. Company Name resolution
  // Check from task.account_key in companies table first
  if (task.account_key) {
    const compRow = db.prepare('SELECT name FROM companies WHERE account_key=?').get(task.account_key)
    if (compRow && compRow.name) company = compRow.name
  }
  if (!company && task.raw_json) {
    try {
      const parsed = JSON.parse(task.raw_json)
      if (parsed.company) company = parsed.company
    } catch {}
  }

  // 2. Official Title detection from PDF content or known ETA patterns
  // Pattern 1: تجديد نظام الدفعات المقدمة / إخطار بالموافقة
  if ((text.includes('دفعات') || text.includes('دﻓﻌﺎت')) && (text.includes('تجديد') || text.includes('ﺗﺠﺪﻳﺪ') || text.includes('موافقة') || text.includes('املﻮاﻓﻘﺔ'))) {
    officialTitle = 'إخطار بالموافقة على تجديد نظام الدفعات المقدمة'
  }
  // Pattern 2: نموذج 19 ضريبة / ربط
  else if ((text.includes('19') || text.includes('١٩')) && (text.includes('ربط') || text.includes('عناصر') || text.includes('دمغة') || text.includes('نموذج') || text.includes('ﻤﻧﻮذج'))) {
    officialTitle = 'نموذج (19) ضرائب — إخطار بعناصر ربط الضريبة'
  }
  // Pattern 3: نموذج 15 فحص
  else if ((text.includes('15') || text.includes('١٥')) && (text.includes('فحص') || text.includes('فحص'))) {
    officialTitle = 'نموذج (15) فحص ضريبي'
  }
  // Pattern 4: قرار لجنة الطعن
  else if (text.includes('طعن') || text.includes('الطعن') || text.includes('اﻟﻄﻌﻦ')) {
    officialTitle = 'إعلان بقرار لجنة الطعن الضريبي'
  }
  // Pattern 5: إخطار تجهيز المستندات
  else if (text.includes('تجهيز') || text.includes('ﺗﺠﻬﻴﺰ')) {
    officialTitle = 'إخطار تجهيز مستندات للفحص الضريبي'
  }
  // Pattern 6: إخطار تأكيد استلام
  else if (text.includes('استلام') || text.includes('إستلام') || text.includes('تاكيد') || text.includes('تأكيد')) {
    officialTitle = 'إخطار تأكيد استلام المستندات'
  }
  // Pattern 7: نموذج 38 مرتبات
  else if (text.includes('38') || text.includes('٣٨') || text.includes('مرتبات')) {
    officialTitle = 'نموذج (38) ضريبة المرتبات وما في حكمها'
  }

  // Fallback to cleaned task title if text didn't match
  if (!officialTitle) {
    officialTitle = String(task.title || '').replace(/\(\d+\)/g, '').trim()
  }

  // 3. Extract reference number from task title or text
  const numMatch = (task.title || '').match(/(\d{8,14})/) || text.match(/(\d{8,14})/)
  if (numMatch) refNumber = numMatch[1]

  // Clean filename: Arabic Title - Company.pdf (avoid characters forbidden in filenames)
  const sanitize = (s) => s.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim()
  const displayFilename = company 
    ? `${sanitize(officialTitle)} — ${sanitize(company)}.pdf`
    : `${sanitize(officialTitle)}.pdf`

  // Rich caption for WhatsApp
  const lines = [
    `📄 *${officialTitle}*`,
    company ? `🏢 *الشركة:* ${company}` : '',
    refNumber ? `📋 *رقم المستند/الطلب:* ${refNumber}` : '',
    task.deadline ? `⏳ *الموعد المسجل:* ${task.deadline}` : ''
  ].filter(Boolean)

  const caption = lines.join('\n')

  return { officialTitle, company, refNumber, displayFilename, caption }
}

// Test on our specific task
const task = db.prepare('SELECT * FROM tasks WHERE id=\'tasks_362b02a924da6eb7a364f183\'').get()
extractPdfText(task.pdf_path).then(res => {
  const meta = parseOfficialPdfDetails(res.text, task, db)
  console.log('RESULT:')
  console.log('officialTitle  :', meta.officialTitle)
  console.log('company        :', meta.company)
  console.log('refNumber      :', meta.refNumber)
  console.log('displayFilename:', meta.displayFilename)
  console.log('caption:\n' + meta.caption)
}).catch(console.error)
