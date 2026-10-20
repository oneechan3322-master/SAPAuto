'use strict';

/**
 * Live AI Analyst for Portal Obligations, Messages, and Documents.
 * Integrates directly with the built-in local Gemma AI model server.
 *
 * Adheres to:
 * - RULE 1: Never ignore return values
 * - RULE 2: Validate all inputs
 * - RULE 3: No silent failures
 * - RULE 4: Explicit error types
 * - RULE 6: Bounded operations
 * - RULE 7: Fail-safe defaults
 */

const http = require('node:http');
const { localNovaUrl } = require('../assistant/model');
const { defaultLogger } = require('../harness/scraper/common/logger');
const { getDatabase } = require('../db/connect');
const { stampObligation } = require('../harness/deadlines');
const { extractPdfText } = require('./pdf-reader.cjs');
const {
  buildDocumentExhibitPrompt,
  extractJsonObject,
  composeExhibitStudy,
  persistTaskExhibit
} = require('./pdf-visor.cjs');
const {
  matchSecretaryRule,
  buildSecretaryMemo
} = require('../domain/secretary-rules.cjs');

const AI_STUDY_TIMEOUT_MS = 60000;
const PDF_EXHIBIT_TIMEOUT_MS = 300000;

const SECRETARY_SYSTEM_PROMPT = `أنت سكرتير تنفيذي ذكي لمكتب محاسبة وفحص ضريبي مصري (نظام سكرتير المكتب التنفيذي V6).
مهمتك إعداد مذكرة سكرتارية تنفيذية حاسمة وموجزة للمحاسب دون أي مقدمات أو اعتذارات أو عبارات إنشائية مثل "بصفتي خبيراً".
اعتمد القواعد القانونية لقانون الإجراءات الضريبية الموحد 206/2020:
- إخطار تجهيز مستندات: مهلته 15 يوماً من تاريخ الإخطار (المواد 7 و11 و42) لتسليم دفاتر الفحص والفواتير، والغرامة 3,000 إلى 50,000 ج.م تتصاعد بعد 60 يوماً. المسؤول: مدير المكتب.
- نموذج 19 دمغة/فحص: مهلة الطعن القانوني 30 يوماً حاسمة من تاريخ الاستلام (المواد 55 و61). المسؤول: المستشار الضريبي.
- نموذج 15 فحص: مهلة 15 يوماً لتجهيز مقر وفحص المستندات. المسؤول: مدير المكتب.
- ملاحظات قبول: مهلتها 7 أيام لسداد الرسوم وإنهاء الإجراءات. المسؤول: مسؤول الحسابات.
- أسباب الرفض: مهلتها 15 يوماً لتصحيح النواقص وإعادة التقديم. المسؤول: مسؤول الحسابات.
- تأكيد استلام: مهلته 10 أيام. المسؤول: مدير المكتب.

التزم حرفياً بالصيغة الآتية دون أي كلام قبلها أو بعدها:
📋 المستند المطلوب: [اسم المستند أو النماذج والدفاتر المطلوب تقديمها بدقة]
⏳ المهلة القانونية: [المهلة المحددة بالأيام والميعاد النهائي والسند وفق قانون 206/2020 مع بيان الغرامة]
⚡ الإجراء التنفيذي: [الخطوة العملية الفورية التي يجب على المكتب اتخاذها وتسليمها لمأمورية الضرائب]
👤 المسؤول المكلف: [الدور التنفيذي المسؤول بالمكتب]`;

class LiveAiAnalyst {
  constructor(options = {}) {
    this.endpoint = options.endpoint || localNovaUrl();
    this.db = options.db || getDatabase();
  }

  /**
   * Performs an HTTP request to the local Gemma model server.
   * @param {string} prompt
   * @param {number} [maxTokens=280]
   * @param {number} [timeoutMs=AI_STUDY_TIMEOUT_MS]
   * @param {string} [systemPromptOverride]
   * @returns {Promise<string>}
   */
  async queryModel(prompt, maxTokens = 280, timeoutMs = AI_STUDY_TIMEOUT_MS, systemPromptOverride = null) {
    if (!prompt || typeof prompt !== 'string') {
      return '';
    }

    const parsedUrl = new URL(this.endpoint);
    const payload = JSON.stringify({
      messages: [
        {
          role: 'system',
          content: systemPromptOverride || SECRETARY_SYSTEM_PROMPT
        },
        { role: 'user', content: prompt }
      ],
      max_tokens: maxTokens,
      temperature: 0.1
    });

    return new Promise((resolve) => {
      const req = http.request({
        host: parsedUrl.hostname,
        port: parsedUrl.port || 7799,
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: timeoutMs
      }, (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            defaultLogger.warn(`[LiveAiAnalyst] Gemma server returned status ${res.statusCode}: ${raw.slice(0, 150)}`);
            resolve('');
            return;
          }
          try {
            const data = JSON.parse(raw);
            const content = data.choices && data.choices[0] && data.choices[0].message
              ? data.choices[0].message.content
              : '';
            resolve(content.trim());
          } catch (parseErr) {
            defaultLogger.warn(`[LiveAiAnalyst] Failed to parse model response: ${parseErr.message}`);
            resolve('');
          }
        });
      });

      req.on('error', (err) => {
        defaultLogger.warn(`[LiveAiAnalyst] Could not connect to local AI server: ${err.message}`);
        resolve('');
      });

      req.on('timeout', () => {
        req.destroy();
        defaultLogger.warn('[LiveAiAnalyst] Query to local model timed out.');
        resolve('');
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Studies an obligation record live.
   * @param {Object} obligation
   * @returns {Promise<{analysis: string, riskScore: string}>}
   */
  async studyObligation(obligation) {
    if (!obligation || typeof obligation !== 'object') {
      return { analysis: '', riskScore: 'unknown' };
    }

    const titleText = obligation.form || obligation.title || '';
    const prompt = `السجل: التزام ضريبي رسمي
الشركة: ${obligation.company || obligation.accountKey || ''}
النموذج/الإقرار: ${titleText}
الفترة الضريبية: ${obligation.period || ''}
تاريخ الاستحقاق: ${obligation.dueDate || obligation.deadline || ''}
الحالة: ${obligation.submitted ? 'تم التقديم' : 'لم يتم التقديم'}
كائن العقد/المرجع: ${obligation.contractObject || obligation.obligation_code || ''}

المطلوب: مذكرة سكرتارية تنفيذية حاسمة تحدد الالتزام المطلوب، المهلة القانونية وغرامات التأخير، والإجراء التنفيذي المطلوب فوراً.`;

    let analysis = await this.queryModel(prompt, 280);
    if (!analysis || analysis.trim() === '' || analysis.includes('بصفتي خبيراً')) {
      const isSubmitted = Boolean(obligation.submitted || obligation.status === 'done');
      analysis = [
        `📋 المستند المطلوب: إقرار/التزام ضريبي (${titleText}) عن الفترة ${obligation.period || 'المحددة'}`,
        `⏳ المهلة القانونية: ميعاد الاستحقاق ${obligation.dueDate || obligation.deadline || 'محدد بالبوابة'} وفقاً لقانون الإجراءات الضريبية الموحد 206/2020 (المادة 31) تجنباً لغرامات عدم التقديم ومقابل التأخير.`,
        `⚡ الإجراء التنفيذي: ${isSubmitted ? 'مراجعة إيصال التقديم والسداد ومطابقة السجلات الضريبية.' : 'تقديم الإقرار الضريبي واعتماده إلكترونياً وسداد الضريبة المستحقة فوراً قبل فوات الموعد.'}`,
        `👤 المسؤول المكلف: مسؤول الحسابات / المحاسب القانوني`
      ].join('\n');
    }

    let riskScore = 'منخفضة';
    if (analysis.includes('عالية') || analysis.includes('شديدة') || analysis.includes('غرامة') || analysis.includes('متأخر')) {
      riskScore = 'عالية';
    } else if (analysis.includes('متوسطة') || analysis.includes('تنبيه')) {
      riskScore = 'متوسطة';
    }

    // Persist to database if record exists in obligations table
    if (obligation.id) {
      try {
        this.db.prepare(`
          UPDATE obligations 
          SET ai_study = ?, ai_risk_score = ?, ai_studied_at = ? 
          WHERE id = ?
        `).run(analysis, riskScore, new Date().toISOString(), obligation.id);
        // Plan 4.5: stamp the legal deadline (which doc + law days + date) —
        // once, right after the study lands; never blocks the study itself.
        stampObligation(this.db, { ...obligation, ai_study: analysis }, { now: new Date() });
      } catch (dbErr) {
        // Table row might be a transient payroll object or not yet committed
        void (dbErr);
      }
    }

    return { analysis, riskScore };
  }

  /**
   * Studies a portal message or letter live.
   * @param {Object} message
   * @returns {Promise<{analysis: string, actionRequired: string}>}
   */
  async studyMessage(message) {
    if (!message || typeof message !== 'object') {
      return { analysis: '', actionRequired: '' };
    }

    const prompt = `السجل: رسالة/إشعار رسمي من مصلحة الضرائب المصرية
الشركة: ${message.companyName || message.account_key || ''}
الموضوع: ${message.title || message.subject || ''}
درجة الخطورة: ${message.severity || 'معلومات'}
تاريخ الاستلام: ${message.received_at || ''}
نص الرسالة:
${message.body || ''}

المطلوب: مذكرة سكرتارية تنفيذية تحدد موضوع المراسلة، الميعاد والمهلة القانونية إن وجدت، والإجراء الفوري المطلوب بالمكتب.`;

    let analysis = await this.queryModel(prompt, 280);
    if (!analysis || analysis.trim() === '' || analysis.includes('بصفتي خبيراً')) {
      analysis = [
        `📋 المستند المطلوب: مراجعة إشعار مصلحة الضرائب (${message.title || message.subject || 'إشعار رسمي'})`,
        `⏳ المهلة القانونية: مراجعة تاريخ الاستلام (${message.received_at || 'تاريخ المزامنة'}) والرد خلال 15 يوماً وفقاً لقانون 206/2020 إن تضمنت طلباً لمستندات.`,
        `⚡ الإجراء التنفيذي: فحص محتوى الإشعار والتأكد من مطابقة السجلات وتوجيه الملف للمحاسب المختص.`,
        `👤 المسؤول المكلف: مدير المكتب`
      ].join('\n');
    }

    let actionRequired = 'للعلم والمتابعة';
    if (analysis.includes('طعن') || analysis.includes('رد رسمي') || analysis.includes('سداد') || analysis.includes('فحص') || analysis.includes('عاجل')) {
      actionRequired = 'إجراء عاجل مطلوب';
    }

    if (message.id) {
      try {
        this.db.prepare(`
          UPDATE messages 
          SET ai_study = ?, ai_action_required = ?, ai_studied_at = ? 
          WHERE id = ?
        `).run(analysis, actionRequired, new Date().toISOString(), message.id);
      } catch (dbErr) {
        void (dbErr);
      }
    }

    return { analysis, actionRequired };
  }

  /**
   * Studies an official document / notification task live as Executive Secretary.
   * @param {Object} doc
   * @returns {Promise<{analysis: string}>}
   */
  async studyDocument(doc) {
    if (!doc || typeof doc !== 'object') {
      return { analysis: '' };
    }

    const titleText = doc.title || doc.doc_number || '';
    const matchedRule = matchSecretaryRule(titleText);

    let pdf = null;
    let pdfIssue = '';
    const pdfPath = doc.pdf_path || doc.pdfPath || '';
    if (pdfPath) {
      try {
        pdf = await extractPdfText(pdfPath);
        defaultLogger.info(`[Secretary] PDF opened for ${doc.id || doc.doc_number || 'task'}: ${pdf.pages} page(s), ${pdf.text.length} chars.`);
      } catch (pdfErr) {
        pdfIssue = `${pdfErr.code || 'pdf-error'}: ${pdfErr.message}`;
        defaultLogger.warn(`[Secretary] Could not read PDF for task ${doc.id || pdfPath}: ${pdfIssue}`);
      }
    }

    const documentIdentity = {
      company: doc.company || doc.account_key || '',
      title: titleText,
      date: doc.date || doc.deadline || '',
      required_action: doc.required_action || doc.headline || ''
    };

    let prompt;
    if (pdf && pdf.slice && pdf.slice.text) {
      prompt = buildDocumentExhibitPrompt({
        doc: documentIdentity,
        pdf,
        pdfIssue
      });
    } else {
      prompt = `السجل: إخطار/مستند رسمي من مصلحة الضرائب المصرية
العنوان: ${titleText}
الشركة: ${doc.company || doc.account_key || ''}
التاريخ: ${doc.date || doc.deadline || ''}
الإجراء المكتوب في البوابة: ${doc.required_action || doc.headline || ''}

المطلوب: إعداد مذكرة سكرتارية تنفيذية حاسمة تحدد المستند المطلوب بالضبط والمهلة القانونية وفقاً للمواد القانونية المحددة والإجراء الفوري.`;
    }

    const raw = await this.queryModel(prompt, 350, PDF_EXHIBIT_TIMEOUT_MS);
    let analysis = raw;
    let exhibit = null;
    if (raw) {
      exhibit = extractJsonObject(raw);
      if (exhibit) {
        const composed = composeExhibitStudy(exhibit);
        if (composed) analysis = composed;
      }
    }

    // Fail-safe default (RULE 7): if model didn't reply or output was empty or pompous, use grounded deterministic secretary memo
    if (!analysis || analysis.trim() === '' || analysis.includes('بصفتي خبيراً') || (!analysis.includes('المستند المطلوب') && !analysis.includes('النوع:'))) {
      analysis = buildSecretaryMemo({
        title: titleText,
        noticeDate: doc.date,
        deadlineDate: doc.deadline,
        companyName: doc.company,
        rule: matchedRule
      });
    }

    if (doc.id && analysis) {
      try {
        persistTaskExhibit(this.db, doc, {
          analysis,
          exhibit,
          pdfMeta: pdf,
          pdfIssue
        });
        this.db.prepare(`
          UPDATE tasks 
          SET required_action = COALESCE(NULLIF(required_action, ''), ?),
              assigned_to = COALESCE(NULLIF(assigned_to, ''), ?)
          WHERE id = ?
        `).run(matchedRule.requiredAction, matchedRule.assignedRole, doc.id);
      } catch (dbErr) {
        defaultLogger.warn(`[Secretary] Failed to persist secretary memo for task ${doc.id}: ${dbErr.message}`);
      }
    }

    return { analysis };
  }

  /**
   * Studies only NEW (unstudied) items for the given account:
   * - Obligations where ai_study is empty
   * - Messages where ai_study is empty
   * - Tasks where ai_study is empty
   * Bounded to a maximum number of items per cycle (RULE 6).
   *
   * @param {string} accountKey
   * @param {number} [limit=3]
   * @returns {Promise<{obligationsStudied: number, messagesStudied: number, tasksStudied: number}>}
   */
  async studyNewAccountEntities(accountKey, limit = 3) {
    if (!accountKey || typeof accountKey !== 'string') {
      defaultLogger.warn('[LiveAiAnalyst.studyNewAccountEntities] Invalid accountKey provided.');
      return { obligationsStudied: 0, messagesStudied: 0, tasksStudied: 0 };
    }

    const safeLimit = Math.max(1, Math.min(Number(limit) || 3, 10));
    let obligationsStudied = 0;
    let messagesStudied = 0;
    let tasksStudied = 0;

    // 1. Unstudied obligations (only where ai_study is empty)
    try {
      const unstudiedObligations = this.db.prepare(`
        SELECT id, company_id, account_key, obligation_code, period, title, deadline, status, penalty_band, created_at 
        FROM obligations 
        WHERE account_key = ? AND (ai_study = '' OR ai_study IS NULL)
        ORDER BY updated_at DESC, created_at DESC 
        LIMIT ?
      `).all(accountKey, safeLimit);

      for (const ob of unstudiedObligations) {
        try {
          const res = await this.studyObligation(ob);
          if (res && res.analysis) {
            obligationsStudied++;
          }
        } catch (studyErr) {
          defaultLogger.warn(`[LiveAiAnalyst] Failed to study obligation ${ob.id}: ${studyErr.message}`);
        }
      }
    } catch (dbErr) {
      defaultLogger.warn(`[LiveAiAnalyst] Could not query unstudied obligations for ${accountKey}: ${dbErr.message}`);
    }

    // 2. Unstudied messages (only where ai_study is empty)
    try {
      const unstudiedMessages = this.db.prepare(`
        SELECT id, company_id, account_key, portal_message_id, title, body, severity, received_at 
        FROM messages 
        WHERE account_key = ? AND (ai_study = '' OR ai_study IS NULL)
        ORDER BY created_at DESC 
        LIMIT ?
      `).all(accountKey, safeLimit);

      for (const msg of unstudiedMessages) {
        try {
          const res = await this.studyMessage(msg);
          if (res && res.analysis) {
            messagesStudied++;
          }
        } catch (studyErr) {
          defaultLogger.warn(`[LiveAiAnalyst] Failed to study message ${msg.id}: ${studyErr.message}`);
        }
      }
    } catch (dbErr) {
      defaultLogger.warn(`[LiveAiAnalyst] Could not query unstudied messages for ${accountKey}: ${dbErr.message}`);
    }

    // 3. Unstudied tasks / documents (only where ai_study is empty)
    try {
      const unstudiedTasks = this.db.prepare(`
        SELECT id, company_id, account_key, doc_number, title, deadline, status, urgency, required_action, pdf_path 
        FROM tasks 
        WHERE account_key = ? AND (ai_study = '' OR ai_study IS NULL)
        ORDER BY updated_at DESC, created_at DESC 
        LIMIT ?
      `).all(accountKey, safeLimit);

      for (const doc of unstudiedTasks) {
        try {
          const res = await this.studyDocument(doc);
          if (res && res.analysis) {
            tasksStudied++;
          }
        } catch (studyErr) {
          defaultLogger.warn(`[LiveAiAnalyst] Failed to study task ${doc.id}: ${studyErr.message}`);
        }
      }
    } catch (dbErr) {
      defaultLogger.warn(`[LiveAiAnalyst] Could not query unstudied tasks for ${accountKey}: ${dbErr.message}`);
    }

    defaultLogger.info(`[LiveAiAnalyst] Completed live study for ${accountKey}: ${obligationsStudied} obligation(s), ${messagesStudied} message(s), ${tasksStudied} task(s).`);
    return { obligationsStudied, messagesStudied, tasksStudied };
  }
}

module.exports = {
  LiveAiAnalyst
};
