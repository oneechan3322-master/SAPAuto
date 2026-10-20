'use strict';

/**
 * Company Legal Documents Archive Domain (أرشيف الوثائق والسجلات القانونية والمهل الرسمية).
 *
 * Implements authoritative tracking for:
 * 1. البطاقة الضريبية (Tax Card)
 * 2. السجل التجاري (Commercial Registry)
 * 3. شهادة تسجيل الضريبة على القيمة المضافة (VAT Registration Certificate)
 * 4. البطاقة الشخصية للمفوض/المدير (National ID of Authorized Signatory)
 * 5. التوقيع الإلكتروني / الختم الإلكتروني (E-Signature / E-Seal Certificate)
 * 6. وثائق وتراخيص أخرى (Other Legal Licenses & Contracts)
 *
 * Adheres strictly to USER RULES:
 * - RULE 1: Never ignore return values
 * - RULE 2: Validate all inputs at entry
 * - RULE 3: No silent failures
 * - RULE 4: Explicit error types
 * - RULE 6: Bounded operations
 * - RULE 7: Fail-safe defaults
 * - RULE 10: Defensive redundancy
 */

const { cairoDayOf, daysBetweenCairo, formatArabicDays } = require('./legal-deadlines.cjs');

/**
 * Authoritative document definitions for Egyptian companies.
 */
const STANDARD_DOCUMENT_TYPES = Object.freeze({
  tax_card: {
    type: 'tax_card',
    arabicName: 'البطاقة الضريبية',
    defaultIssuer: 'مصلحة الضرائب المصرية',
    defaultRole: 'المحاسب القانوني للملف',
    renewalCycle: '5 سنوات (المادة 21 قانون 206/2020)',
    validityYears: 5,
    description: 'بطاقة التسجيل الضريبي السارية الصادرة من مأمورية الضرائب المختصة'
  },
  commercial_registry: {
    type: 'commercial_registry',
    arabicName: 'السجل التجاري',
    defaultIssuer: 'مكتب السجل التجاري - جهاز تنمية التجارة الداخلية',
    defaultRole: 'الشؤون القانونية وشؤون الشركات',
    renewalCycle: '5 سنوات (تجديد قيد السجل التجاري دورياً)',
    validityYears: 5,
    description: 'مستخرج السجل التجاري الحديث وقيد الشركة والأنشطة والمديرين'
  },
  vat_certificate: {
    type: 'vat_certificate',
    arabicName: 'شهادة تسجيل الضريبة على القيمة المضافة',
    defaultIssuer: 'مصلحة الضرائب المصرية (شعبة القيمة المضافة)',
    defaultRole: 'المحاسب القانوني للملف',
    renewalCycle: 'مستند دائم مع فحص دوري للحالة (مسجل / مكلف)',
    validityYears: 5,
    description: 'شهادة التسجيل الرسمية في ضريبة القيمة المضافة للمكلفين'
  },
  national_id: {
    type: 'national_id',
    arabicName: 'بطاقة الرقم القومي (المفوض / المدير المسؤول)',
    defaultIssuer: 'قطاع الأحوال المدنية - وزارة الداخلية',
    defaultRole: 'المفوض بالتوقيع / المدير المسؤول',
    renewalCycle: '7 سنوات من تاريخ الإصدار',
    validityYears: 7,
    description: 'بطاقة تحقيق الشخصية سارية المفعول لصاحب المنشأة أو المفوض الرسمي'
  },
  e_signature: {
    type: 'e_signature',
    arabicName: 'شهادة التوقيع / الختم الإلكتروني',
    defaultIssuer: 'إيجيبت تراست / مصر للمقاصة',
    defaultRole: 'المدير المالي / مسؤول الفاتورة الإلكترونية',
    renewalCycle: 'من سنة إلى 3 سنوات (تجديد شهادة التوكن الإلكتروني)',
    validityYears: 3,
    description: 'شهادة الختم الإلكتروني الصالحة لمنظومة الفاتورة والإيصال الإلكتروني'
  },
  other: {
    type: 'other',
    arabicName: 'وثيقة قانونية / ترخيص آخر',
    defaultIssuer: 'الجهة الإدارية المختصة',
    defaultRole: 'المحاسب القانوني للملف',
    renewalCycle: 'حسب شروط الترخيص',
    validityYears: 1,
    description: 'تراخيص تشغيل، عقود إيجار، تأمينات اجتماعية، موافقات بيئية'
  }
});

/**
 * Calculates document expiration status and remaining days.
 *
 * @param {string} expiryDate - 'YYYY-MM-DD'
 * @param {Date} [now]
 * @returns {{
 *   daysLeft: number|null,
 *   status: 'expired'|'expiring_soon'|'valid'|'no_date',
 *   statusLabel: string,
 *   countdownLabel: string,
 *   tone: 'urgent'|'attention'|'calm'|'neutral'
 * }}
 */
function evaluateDocumentStatus(expiryDate, now = new Date()) {
  if (!expiryDate || typeof expiryDate !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(expiryDate.trim())) {
    return {
      daysLeft: null,
      status: 'no_date',
      statusLabel: 'غير محدد التاريخ',
      countdownLabel: 'تاريخ الانتهاء غير مسجل',
      tone: 'neutral'
    };
  }

  const cleanDate = expiryDate.trim().slice(0, 10);
  const days = daysBetweenCairo(now, cleanDate);

  if (days === null) {
    return {
      daysLeft: null,
      status: 'no_date',
      statusLabel: 'تاريخ غير صالح',
      countdownLabel: 'تاريخ غير صالح',
      tone: 'neutral'
    };
  }

  if (days < 0) {
    const absDays = Math.abs(days);
    return {
      daysLeft: days,
      status: 'expired',
      statusLabel: 'منتهي الصلاحية',
      countdownLabel: `انتهت الصلاحية منذ ${formatArabicDays(absDays)}`,
      tone: 'urgent'
    };
  }

  if (days === 0) {
    return {
      daysLeft: 0,
      status: 'expiring_soon',
      statusLabel: 'ينتهي اليوم',
      countdownLabel: 'ينتهي اليوم!',
      tone: 'urgent'
    };
  }

  if (days <= 60) {
    return {
      daysLeft: days,
      status: 'expiring_soon',
      statusLabel: 'يوشك على الانتهاء',
      countdownLabel: `متبقٍ ${formatArabicDays(days)} على التجديد`,
      tone: 'attention'
    };
  }

  return {
    daysLeft: days,
    status: 'valid',
    statusLabel: 'ساري وصالح',
    countdownLabel: `سارٍ — متبقٍ ${formatArabicDays(days)}`,
    tone: 'calm'
  };
}

/**
 * Synchronizes portal obligations (Tax Card & VAT Certificate validity) to company_documents table.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ synced: number, created: number, updated: number }}
 */
function syncPortalDocumentsToArchive(db) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('Valid SQLite database instance is required for syncPortalDocumentsToArchive');
  }

  let createdCount = 0;
  let updatedCount = 0;

  const companies = db.prepare('SELECT id, account_key, name FROM companies').all();
  if (!companies || companies.length === 0) {
    return { synced: 0, created: 0, updated: 0 };
  }

  const insertStmt = db.prepare(`
    INSERT INTO company_documents (
      id, company_id, account_key, doc_type, doc_name, doc_number,
      issuer, issue_date, expiry_date, assigned_role, status, notes,
      file_path, source, created_at, updated_at
    ) VALUES (
      @id, @company_id, @account_key, @doc_type, @doc_name, @doc_number,
      @issuer, @issue_date, @expiry_date, @assigned_role, @status, @notes,
      @file_path, @source, @created_at, @updated_at
    )
  `);

  const updateStmt = db.prepare(`
    UPDATE company_documents
    SET expiry_date = @expiry_date,
        status = @status,
        updated_at = @updated_at
    WHERE id = @id
  `);

  const findDocStmt = db.prepare(`
    SELECT id, expiry_date, source FROM company_documents
    WHERE company_id = ? AND doc_type = ?
    LIMIT 1
  `);

  const findPortalObligations = db.prepare(`
    SELECT title, deadline, obligation_code FROM obligations
    WHERE company_id = ? AND (
      title LIKE '%البطاقة الضريبية سارية%' OR
      title LIKE '%شهادة تسجيل ض قيمة مضافة سارية%'
    )
  `);

  const nowIso = new Date().toISOString();

  for (const comp of companies) {
    const obligations = findPortalObligations.all(comp.id);
    for (const obl of obligations) {
      let docType = null;
      let docDef = null;

      if (obl.title.includes('البطاقة الضريبية')) {
        docType = 'tax_card';
        docDef = STANDARD_DOCUMENT_TYPES.tax_card;
      } else if (obl.title.includes('قيمة مضافة')) {
        docType = 'vat_certificate';
        docDef = STANDARD_DOCUMENT_TYPES.vat_certificate;
      }

      if (!docType || !obl.deadline) continue;

      const evalResult = evaluateDocumentStatus(obl.deadline);
      const existing = findDocStmt.get(comp.id, docType);

      if (existing) {
        if (existing.expiry_date !== obl.deadline) {
          updateStmt.run({
            id: existing.id,
            expiry_date: obl.deadline,
            status: evalResult.status,
            updated_at: nowIso
          });
          updatedCount++;
        }
      } else {
        const docId = `doc_${comp.id}_${docType}`;
        insertStmt.run({
          id: docId,
          company_id: comp.id,
          account_key: comp.account_key || '',
          doc_type: docType,
          doc_name: docDef.arabicName,
          doc_number: '',
          issuer: docDef.defaultIssuer,
          issue_date: '',
          expiry_date: obl.deadline,
          assigned_role: docDef.defaultRole,
          status: evalResult.status,
          notes: 'تم استيراد تاريخ الصلاحية تلقائياً من بوابة مصلحة الضرائب المصرية',
          file_path: '',
          source: 'portal_sync',
          created_at: nowIso,
          updated_at: nowIso
        });
        createdCount++;
      }
    }

    // Ensure placeholders exist for the remaining standard documents if missing
    for (const [typeKey, def] of Object.entries(STANDARD_DOCUMENT_TYPES)) {
      if (typeKey === 'other') continue;
      const existing = findDocStmt.get(comp.id, typeKey);
      if (!existing) {
        const docId = `doc_${comp.id}_${typeKey}`;
        insertStmt.run({
          id: docId,
          company_id: comp.id,
          account_key: comp.account_key || '',
          doc_type: typeKey,
          doc_name: def.arabicName,
          doc_number: '',
          issuer: def.defaultIssuer,
          issue_date: '',
          expiry_date: '',
          assigned_role: def.defaultRole,
          status: 'no_date',
          notes: `بانتظار تسجيل بيانات ${def.arabicName}`,
          file_path: '',
          source: 'manual',
          created_at: nowIso,
          updated_at: nowIso
        });
        createdCount++;
      }
    }
  }

  return {
    synced: companies.length,
    created: createdCount,
    updated: updatedCount
  };
}

/** Mirrors actual PDF notices downloaded from SAP into the company archive. */
function syncPortalTaskPdfsToArchive(db) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('Valid SQLite database instance is required');
  const nowIso = new Date().toISOString();
  const tasks = db.prepare(`SELECT id,company_id,account_key,doc_number,title,pdf_path,assigned_to,created_at,updated_at
    FROM tasks WHERE pdf_path<>''`).all();
  const upsert = db.prepare(`INSERT INTO company_documents(
    id,company_id,account_key,doc_type,doc_name,doc_number,issuer,issue_date,expiry_date,assigned_role,status,notes,file_path,source,
    direction,received_at,registered_by,custodian,ocr_state,created_at,updated_at
  ) VALUES(@id,@company_id,@account_key,'portal_document',@doc_name,@doc_number,'بوابة الضرائب المصرية',@issue_date,'',@assigned_role,'no_date',@notes,@file_path,'portal_pdf',
    'incoming',@received_at,'SAP portal',@custodian,'pending',@created_at,@updated_at)
  ON CONFLICT(id) DO UPDATE SET doc_name=excluded.doc_name,doc_number=excluded.doc_number,file_path=excluded.file_path,
    assigned_role=excluded.assigned_role,custodian=excluded.custodian,received_at=excluded.received_at,updated_at=excluded.updated_at`);
  for (const task of tasks) {
    upsert.run({
      id: `portal_pdf_${task.id}`,
      company_id: task.company_id,
      account_key: task.account_key || '',
      doc_name: task.title || 'مستند وارد من بوابة الضرائب',
      doc_number: task.doc_number || '',
      issue_date: task.created_at || '',
      assigned_role: task.assigned_to || 'مسؤول الحسابات',
      notes: 'نسخة PDF واردة فعلياً من بوابة الضرائب المصرية.',
      file_path: task.pdf_path,
      received_at: task.updated_at || task.created_at || nowIso,
      custodian: task.assigned_to || 'مسؤول الحسابات',
      created_at: task.created_at || nowIso,
      updated_at: task.updated_at || nowIso
    });
  }
  return { synced: tasks.length };
}

module.exports = {
  STANDARD_DOCUMENT_TYPES,
  evaluateDocumentStatus,
  syncPortalDocumentsToArchive,
  syncPortalTaskPdfsToArchive
};
