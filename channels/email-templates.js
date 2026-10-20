'use strict'

/**
 * High-Clarity Executive Email Template for SAPAuto (Ported & Enhanced from V5 / V6).
 * Built specifically for Arabic Tax Office Secretarial Reports.
 * Clean, high-contrast, beautiful cards, color-coded badges, full summary & tables,
 * with PDF attachments chip indicator.
 */

function escapeHtml(value) {
  if (value === undefined || value === null) return ''
  return String(value)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;')
}

function cairoFormattedDateTime(date = new Date()) {
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Africa/Cairo'
  }).format(date)
}

/**
 * Builds the V5/V6-style rich executive email HTML.
 */
function renderV5ExecutiveEmail({
  recipientName = 'الأستاذ رامي جلال',
  reportTitle = 'تقرير مستندات وموقف مصلحة الضرائب المصرية (SAP MCF)',
  monthKey = '2026-10',
  date = new Date(),
  stats = {
    companies: 23,
    tasks: 192,
    obligations: 785,
    payments: 875,
    messages: 474,
    docs: 115
  },
  urgentTasks = [],
  openObligations = [],
  recentMessages = [],
  accountsSummary = [],
  attachedPdfCount = 0,
  dashboardUrl = 'http://192.168.100.14:3000/board'
}) {
  const generatedTime = cairoFormattedDateTime(date)
  const decisionNeededCount = urgentTasks.length

  // 1. Urgent Decision Cards (The iconic V5 Blue & Red box)
  let urgentCardsHtml = ''
  if (urgentTasks.length > 0) {
    const cards = urgentTasks.slice(0, 6).map(task => {
      const isOverdue = task.urgency === 'overdue' || task.urgency === 'urgent'
      const badgeStyle = isOverdue
        ? 'background-color: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5;'
        : 'background-color: #e0f2fe; color: #0284c7; border: 1px solid #bae6fd;'
      const badgeText = isOverdue ? 'متجاوز الموعد' : 'قيد المتابعة'
      const hasPdf = Boolean(task.pdf_path)

      return `
        <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; margin-bottom: 10px; border-right: 5px solid ${isOverdue ? '#ef4444' : '#0284c7'}; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
            <span style="font-size: 15px; font-weight: 800; color: #0f172a;">${escapeHtml(task.title || task.docTitle)}</span>
            <div style="display: flex; gap: 6px; align-items: center;">
              ${hasPdf ? `<span style="background-color: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 12px;">📎 PDF مرفق</span>` : ''}
              <span style="${badgeStyle} font-size: 11px; font-weight: 700; padding: 2px 10px; border-radius: 12px; white-space: nowrap;">${badgeText}</span>
            </div>
          </div>
          <div style="font-size: 12px; color: #64748b; margin-bottom: 8px;">
            🏢 <strong>${escapeHtml(task.account_key || task.company || '')}</strong>
            ${task.doc_number ? ` • مستند رقم: <code style="direction: ltr; display: inline-block; font-family: monospace; background: #f1f5f9; padding: 1px 6px; border-radius: 4px;">${escapeHtml(task.doc_number)}</code>` : ''}
            ${task.deadline ? ` • المهلة: <strong style="color: #b91c1c;">${escapeHtml(task.deadline)}</strong>` : ''}
          </div>
          <div style="font-size: 12.5px; color: #334155; background-color: #f8fafc; padding: 8px 12px; border-radius: 6px; line-height: 1.6;">
            📌 <strong>الإجراء المطلوب:</strong> مراجعة المستند الصادر من المنظومة وسداد الالتزام أو تقديم الطعن قبل فوات الميعاد القانوني.
          </div>
        </div>
      `
    }).join('')

    urgentCardsHtml = `
      <div style="margin-bottom: 24px; background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 12px; padding: 18px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
          <h3 style="margin: 0; font-size: 16px; font-weight: 800; color: #0369a1;">
            ⚡ صندوق عمل اليوم — أبرز المهام العاجلة المطلوب اتخاذ قرار بشأنها
          </h3>
          <span style="background-color: #0284c7; color: #ffffff; padding: 3px 12px; border-radius: 14px; font-size: 12px; font-weight: 700;">
            ${decisionNeededCount} مهام عاجلة
          </span>
        </div>
        ${cards}
        ${urgentTasks.length > 6 ? `<div style="text-align: center; font-size: 12px; color: #0284c7; font-weight: bold; margin-top: 8px;">+ ${urgentTasks.length - 6} مهام أخرى مسجلة في لوحة التحكم</div>` : ''}
      </div>
    `
  }

  // 2. Statutory Filing Obligations Section (V5 Amber Table)
  let obligationsHtml = ''
  if (openObligations.length > 0) {
    const obRows = openObligations.slice(0, 5).map(o => `
      <tr style="border-bottom: 1px solid #fed7aa; background-color: #ffffff;">
        <td style="padding: 10px 14px; font-weight: 700; color: #7c2d12;">${escapeHtml(o.title)}</td>
        <td style="padding: 10px 14px; color: #431407;">${escapeHtml(o.company || o.account_key || '—')}</td>
        <td style="padding: 10px 14px; color: #7c2d12; direction: ltr; text-align: center; font-family: monospace;">${escapeHtml(o.period || o.deadline || '2026-10')}</td>
        <td style="padding: 10px 14px; text-align: center;">
          <span style="background-color: #ffedd5; color: #c2410c; border: 1px solid #fdba74; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: bold;">
            إقرار مستحق
          </span>
        </td>
      </tr>
    `).join('')

    obligationsHtml = `
      <div style="margin-bottom: 24px; background-color: #fff7ed; border: 1px solid #fdba74; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.04);">
        <div style="background: linear-gradient(135deg, #c2410c, #ea580c); color: #ffffff; padding: 12px 18px; display: flex; justify-content: space-between; align-items: center;">
          <h3 style="margin: 0; font-size: 15px; font-weight: 800;">
            📅 التزامات وإقرارات الفحص الضريبي (${stats.obligations})
          </h3>
          <span style="background: rgba(255,255,255,0.25); padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: bold;">متابعة المواعيد</span>
        </div>
        <table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 12px;">
          <thead>
            <tr style="background-color: #ffedd5; color: #9a3412; font-size: 11px;">
              <th style="padding: 8px 14px;">الالتزام الضريبي</th>
              <th style="padding: 8px 14px;">الشركة</th>
              <th style="padding: 8px 14px; text-align: center;">الفترة / المهلة</th>
              <th style="padding: 8px 14px; text-align: center;">الحالة</th>
            </tr>
          </thead>
          <tbody>
            ${obRows}
          </tbody>
        </table>
      </div>
    `
  }

  // 3. Official Portal Messages (V5 Emerald Box)
  let messagesHtml = ''
  if (recentMessages.length > 0) {
    const msgCards = recentMessages.slice(0, 3).map(m => `
      <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; margin-bottom: 8px; border-right: 4px solid #10b981;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <strong style="font-size: 13.5px; color: #1e293b;">📌 ${escapeHtml(m.title || 'إشعار صادر من المصلحة')}</strong>
          <span style="background-color: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; padding: 1px 8px; border-radius: 8px; font-size: 11px; font-weight: bold;">وارد جديد</span>
        </div>
        <div style="font-size: 12px; color: #64748b; margin-bottom: 6px;">
          🏢 ${escapeHtml(m.company_name || m.account_key || '')} • ${escapeHtml(m.received_at || 'أكتوبر 2026')}
        </div>
        <div style="font-size: 12.5px; color: #334155; line-height: 1.6; background: #f8fafc; padding: 8px 12px; border-radius: 6px;">
          ${escapeHtml(m.summary || m.preview || 'يرجى مراجعة تفاصيل الإشعار المسجل بحساب المنشأة.')}
        </div>
      </div>
    `).join('')

    messagesHtml = `
      <div style="margin-bottom: 24px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 16px;">
        <h3 style="margin: 0 0 12px 0; font-size: 15px; font-weight: 800; color: #166534;">
          📩 رسائل وإخطارات مصلحة الضرائب الرسمية (${stats.messages})
        </h3>
        ${msgCards}
      </div>
    `
  }

  // 4. Stable Accounts Card Grid (V5 White Card Style with Blue Trim)
  let accountsListHtml = accountsSummary.slice(0, 10).map(acc => `
    <div style="margin-bottom: 12px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
      <div style="background-color: #f8fafc; padding: 10px 16px; border-bottom: 1px solid #edf2f7; display: flex; align-items: center; justify-content: space-between;">
        <div style="font-size: 14px; font-weight: 700; color: #1e293b;">
          🏢 <span style="color: #0284c7;">${escapeHtml(acc.name || acc.label || acc.account_key)}</span>
          <span style="font-size: 11px; font-weight: normal; color: #64748b; margin-right: 6px;">(${escapeHtml(acc.account_key)})</span>
        </div>
        <span style="background-color: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600;">
          حساب مفحوص
        </span>
      </div>
      <div style="padding: 10px 16px; font-size: 12.5px; color: #475569; display: flex; justify-content: space-between; align-items: center;">
        <span><strong style="color: #059669;">✔</strong> تم فحص المستندات والمهل بنجاح</span>
        <span style="font-size: 11px; color: #94a3b8;">${acc.doc_count || 0} مستندات مسجلة</span>
      </div>
    </div>
  `).join('')

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <title>${reportTitle}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: Arial, 'Segoe UI', Tahoma, sans-serif; color: #1e293b; direction: rtl; text-align: right;">
  <div style="max-width: 860px; margin: 20px auto; padding: 10px;">
    
    <!-- Header Banner (V5 Royal Gradient) -->
    <div style="background: linear-gradient(135deg, #0d3880 0%, #1e60c6 100%); color: #ffffff; padding: 26px 28px; border-radius: 14px; margin-bottom: 20px; box-shadow: 0 4px 15px rgba(13, 56, 128, 0.15);">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px;">
        <div>
          <span style="background: rgba(255,255,255,0.18); padding: 3px 12px; border-radius: 12px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; display: inline-block; margin-bottom: 8px;">
            نظام سكرتير المكتب الذكي — SapAuto V8
          </span>
          <h1 style="margin: 0 0 6px 0; font-size: 22px; font-weight: 800; color: #ffffff;">
            📋 تقرير مستندات وموقف مصلحة الضرائب المصرية (SAP MCF)
          </h1>
          <p style="margin: 0; font-size: 13px; opacity: 0.92;">
            ملخص المهام والمستندات لشهر: <strong>${monthKey}</strong> | تاريخ الفحص: ${generatedTime}
          </p>
        </div>
        <div style="background: rgba(255,255,255,0.22); border: 1px solid rgba(255,255,255,0.3); padding: 8px 18px; border-radius: 20px; font-size: 13px; font-weight: bold; white-space: nowrap;">
          🔔 ${decisionNeededCount} مهام تحتاج قراراً
        </div>
      </div>

      <!-- Quick KPI Chips Bar (Iconic V5 Style) -->
      <div style="margin-top: 18px; display: flex; gap: 8px; font-size: 12px; flex-wrap: wrap;">
        <span style="background: rgba(255,255,255,0.15); padding: 5px 12px; border-radius: 10px;">
          إجمالي الشركات: <strong>${stats.companies}</strong>
        </span>
        <span style="background: rgba(255,255,255,0.15); padding: 5px 12px; border-radius: 10px;">
          المهام والملاحظات: <strong>${stats.tasks}</strong>
        </span>
        <span style="background: rgba(255,255,255,0.15); padding: 5px 12px; border-radius: 10px;">
          الالتزامات الضريبية: <strong>${stats.obligations}</strong>
        </span>
        <span style="background: rgba(255,255,255,0.15); padding: 5px 12px; border-radius: 10px;">
          المدفوعات المسجلة: <strong>${stats.payments}</strong>
        </span>
        <span style="background: rgba(255,255,255,0.15); padding: 5px 12px; border-radius: 10px;">
          أرشيف المهل والشهادات: <strong>${stats.docs}</strong>
        </span>
        ${attachedPdfCount > 0 ? `
        <span style="background: #22c55e; color: #ffffff; padding: 5px 14px; border-radius: 10px; font-weight: bold; box-shadow: 0 2px 6px rgba(0,0,0,0.15);">
          📎 تم إرفاق ${attachedPdfCount} ملف PDF في الرسالة
        </span>` : ''}
      </div>
    </div>

    <!-- Executive Greeting & Secretary Memo (V5 Teal Box) -->
    <div style="background-color: #ffffff; border-right: 5px solid #0d9488; border-radius: 10px; padding: 18px 22px; margin-bottom: 22px; box-shadow: 0 2px 6px rgba(0,0,0,0.03); border: 1px solid #e2e8f0; border-right-width: 5px;">
      <div style="font-weight: 800; color: #0f766e; font-size: 14.5px; margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
        <span>🤖</span> <span>مذكرة وتوجيه السكرتير الذكي:</span>
      </div>
      <div style="font-size: 13.5px; line-height: 1.7; color: #334155;">
        مرحباً <strong>${recipientName}</strong>،<br>
        تم استكمال دورة الفحص الشاملة بنجاح لكافة حسابات وشركات المكتب على بوابة مصلحة الضرائب المصرية. تم استخراج وحصر جميع النماذج الصادرة، إخطارات الفحص، الإقرارات المستحقة، ومطالبات السداد المسجلة برقم السجل الضريبي لكل منشأة.${attachedPdfCount > 0 ? ` تم إرفاق كافة ملفات الـ PDF المستخرجة رسمياً من المنظومة (${attachedPdfCount} ملف) مباشرة مع هذا البريد الإلكتروني للمعاينة والطباعة الفورية.` : ''}
      </div>
    </div>

    <!-- 1. Urgent Action Tasks & Directives -->
    ${urgentCardsHtml}

    <!-- 2. Statutory Filing Obligations -->
    ${obligationsHtml}

    <!-- 3. Official Portal Messages & Letters -->
    ${messagesHtml}

    <!-- 4. Detailed Account Sections -->
    <div style="margin-bottom: 24px;">
      <h3 style="font-size: 16px; font-weight: 800; color: #1e293b; margin: 0 0 14px 0;">
        🏢 سجل موقف الشركات والحسابات الممسوحة
      </h3>
      ${accountsListHtml}
    </div>

    <!-- Call to action button -->
    <div style="text-align: center; margin: 30px 0;">
      <a href="${dashboardUrl}" target="_blank" style="display: inline-block; padding: 14px 34px; background-color: #1e60c6; color: #ffffff; font-size: 14.5px; font-weight: 800; text-decoration: none; border-radius: 10px; box-shadow: 0 4px 12px rgba(30, 96, 198, 0.3);">
        فتح لوحة القيادة والمتابعة المباشرة على الجهاز ←
      </a>
      <div style="font-size: 12px; color: #94a3b8; margin-top: 8px;">
        الرابط الداخلي: ${dashboardUrl}
      </div>
    </div>

    <!-- Footer Notice (V5 Blue Bottom Note) -->
    <div style="padding: 14px 18px; background-color: #ebf8ff; border-right: 4px solid #3182ce; border-radius: 8px; font-size: 13px; color: #2b6cb0; margin-top: 15px;">
      📌 تم تحويل مستندات مصلحة الضرائب إلى مهام إدارية محددة المواعيد والمسؤوليات، وتحديث أرشيف المهل والوثائق الرقمية آلياً مع إرفاق ملفات الـ PDF.
    </div>

    <div style="text-align: center; margin-top: 18px; font-size: 12px; color: #94a3b8;">
      تم الإنشاء بواسطة نظام سكرتير المكتب الذكي — SapAuto V8
    </div>

  </div>
</body>
</html>`
}

module.exports = {
  renderV5ExecutiveEmail,
  escapeHtml,
  cairoFormattedDateTime
}
