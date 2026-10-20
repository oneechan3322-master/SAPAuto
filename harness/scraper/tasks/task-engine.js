/**
 * Task Engine - Transforms Scraped SAP Documents into Office Tasks.
 * Translates raw notifications into actionable, deadline-tracked items.
 *
 * Adheres to:
 * - RULE 1: Never ignore return values
 * - RULE 2: Validate all inputs
 * - RULE 3: No silent failures
 * - RULE 4: Explicit error types
 * - RULE 6: Bounded operations
 * - RULE 7: Fail-safe defaults
 * - RULE 8: Assertions for invariants
 * - RULE 10: Defensive redundancy
 */

const { assertArray, assertNonEmptyString } = require('../common/assertions');
const { ValidationError } = require('../common/errors');
const { defaultLogger } = require('../common/logger');
const { computeTaskDeadline, evaluateUrgency, normalizeText } = require('./task-rules');
const { evaluatePenaltyBand } = require('../common/penalty-scale');
const { TaskStore } = require('./task-store');
const { todayInCairo } = require('../common/clock');
const { buildCanonicalKeys, canonicalKey } = require('../common/canonical-keys');
const { isPlaceholderName } = require('../config/company-registry');

class TaskEngine {
  /**
   * @param {Object} [options={}]
   * @param {TaskStore} [options.taskStore]
   */
  constructor(options = {}) {
    const opts = (options && typeof options === 'object') ? options : {};

    if (opts.taskStore !== undefined && !(opts.taskStore instanceof TaskStore)) {
      // Previously anything that was not a TaskStore silently fell back to
      // `new TaskStore()` — which is the REAL data/tasks.json. A caller that
      // passed its store wrongly (e.g. positionally) therefore wrote test or
      // caller data into the live register without any error. Fail loudly
      // instead: corrupting the production register is not recoverable by
      // retrying, and the caller needs to know immediately.
      throw new ValidationError('options.taskStore must be a TaskStore instance', {
        receivedType: opts.taskStore === null ? 'null' : typeof opts.taskStore,
        receivedName: opts.taskStore && opts.taskStore.constructor ? opts.taskStore.constructor.name : null
      });
    }

    this.taskStore = opts.taskStore instanceof TaskStore ? opts.taskStore : new TaskStore();
    this.activeUsernames = opts.activeUsernames || null;
  }

  /**
   * Transforms raw account summaries into structured tasks.
   *
   * @param {Array<{account: string, username?: string, docs: Array<any>}>} accountSummaries
   * @param {Date|string} [referenceDate=todayInCairo()]
   * @param {Set<string>|string[]|null} [activeUsernames]
   * @returns {{ tasks: Array<any>, stats: { total: number, todayDecisionCount: number, overdueCount: number, closedCount: number, pdfCount: number, penaltyWithin60Count: number, penaltyBeyond60Count: number, archivedCount: number } }}
   */
  processSummaries(accountSummaries, referenceDate = todayInCairo(), activeUsernames = this.activeUsernames) {
    const summaries = assertArray(accountSummaries, 'accountSummaries', 500, 'TaskEngine.processSummaries');
    const enrichedTasks = [];

    let usernameSet = null;
    if (activeUsernames) {
      // Membership must be case-insensitive for the same reason task ids are:
      // a task stored as "HashimSabry" would otherwise look archived just
      // because the portal spelled it "hashimsabry" this run.
      const activeCanonical = buildCanonicalKeys(
        activeUsernames instanceof Set ? [...activeUsernames] : activeUsernames
      );
      usernameSet = activeCanonical;
    }

    let todayDecisionCount = 0;
    let overdueCount = 0;
    let closedCount = 0;
    let pdfCount = 0;
    let within60Count = 0;
    let beyond60Count = 0;

    // One identity per portal account, however the portal capitalised it this
    // run. Task ids embed the username, so without this the same taxpayer
    // produced "HashimSabry::..." and "hashimsabry::..." as separate records.
    // Spellings are seeded in summary order so the first scrape of a run wins.
    const canonical = buildCanonicalKeys(
      summaries.map((s) => (s && typeof s.username === 'string' ? s.username : ''))
    );

    for (let i = 0; i < summaries.length; i++) {
      const summary = summaries[i];
      // The portal's "name not available" placeholder must never be persisted as
      // a company name. Fall back to the account's own identity so the record is
      // still identifiable instead of showing a sentence where a name belongs.
      const rawCompany = summary.account || '';
      const companyName = isPlaceholderName(rawCompany)
        ? (summary.username || 'ممول غير محدد')
        : rawCompany;
      const username = canonicalKey(canonical, summary.username || '');
      const docs = Array.isArray(summary.docs) ? summary.docs : [];

      // Index all receipt confirmation document numbers for this account
      const confirmedDocNums = new Set();
      for (let k = 0; k < docs.length; k++) {
        const d = docs[k];
        if (!d || d.id === 'ERROR') continue;
        const norm = String(d.title || '').replace(/[\u200e\u200f\u061c]/g, '').replace(/[أإآٱ]/g, 'ا');
        if (norm.includes('تاكيد استلام') || (norm.includes('تاكيد') && norm.includes('استلام'))) {
          if (d.id) confirmedDocNums.add(String(d.id).trim());
        }
      }

      for (let j = 0; j < docs.length; j++) {
        const doc = docs[j];
        if (!doc || doc.id === 'ERROR') {
          continue;
        }

        const docNum = doc.id || `DOC_${j + 1}`;
        const title = doc.title || 'مستند بدون عنوان';
        const dateIssued = doc.date || '';

        // Generate stable task identity
        const taskId = `${username || companyName}::${docNum}::${normalizeText(dateIssued)}::${normalizeText(title)}`;

        // Compute deadline and rules. The same reference instant drives both, so
        // a caller replaying a past date gets deadlines and urgency that agree.
        const deadlineInfo = computeTaskDeadline(dateIssued, title, referenceDate);
        const urgencyInfo = evaluateUrgency(deadlineInfo.deadline, referenceDate);

        // Statutory cost band. urgency only says "overdue"; this says which
        // penalty band the lateness has reached, which is the difference
        // between EGP 3,000 and EGP 2,000,000.
        const penalty = evaluatePenaltyBand(urgencyInfo.daysLeft);

        const titleNorm = String(title).replace(/[\u200e\u200f\u061c]/g, '').replace(/[أإآٱ]/g, 'ا');
        const isPrepNotice = titleNorm.includes('تجهيز');

        let initialStatus = 'pending';
        if (
          doc.status === 'تم الإغلاق' ||
          doc.status === 'تم الاستلام والتأكيد' ||
          (isPrepNotice && confirmedDocNums.has(String(docNum).trim()))
        ) {
          initialStatus = 'closed';
        } else if (urgencyInfo.urgency === 'overdue') {
          initialStatus = 'pending'; // Still pending action even if overdue
        }

        const taskData = {
          id: taskId,
          taskId,
          company: companyName,
          username,
          docNumber: docNum,
          docTitle: title,
          docTypeKey: deadlineInfo.rule.docTypeKey,
          dateIssued,
          deadline: deadlineInfo.deadlineStr,
          deadlineDays: deadlineInfo.deadlineDays,
          status: initialStatus,
          urgency: urgencyInfo.urgency,
          badgeText: urgencyInfo.badgeText,
          badgeClass: urgencyInfo.badgeClass,
          daysLeft: urgencyInfo.daysLeft,
          // Derived from daysLeft; a closed document carries no lateness.
          penaltyBand: initialStatus === 'closed' ? 'not_late' : penalty.band,
          penaltyDays: penalty.daysOverdue,
          penaltyRange: penalty.statutoryRange,
          penaltyBasis: penalty.basis,
          requiredAction: deadlineInfo.rule.defaultAction,
          assignedTo: deadlineInfo.rule.defaultRole,
          pdfPath: doc.pdfPath || '',
          hasPdf: Boolean(doc.pdfPath),
          isCurrentMonth: Boolean(doc.isCurrentMonth),
          headline: doc.headline || ''
        };

        // Upsert into persistent store
        const savedTask = this.taskStore.upsertTask(taskData);

        // Derive isArchived on read (never stored)
        if (usernameSet !== null) {
          const user = (typeof savedTask.username === 'string' && savedTask.username.trim().length > 0)
            ? savedTask.username.trim()
            : (typeof savedTask.account === 'string' && savedTask.account.trim().length > 0
              ? savedTask.account.trim()
              : '');
          savedTask.isArchived = user.length > 0
            && !usernameSet.has(user.trim().toLowerCase());
        } else {
          savedTask.isArchived = Boolean(savedTask.isArchived);
        }

        // Re-evaluate urgency in case task is marked completed in store
        if (savedTask.status === 'completed' || savedTask.status === 'closed') {
          savedTask.urgency = 'completed';
          const isReceipt = String(savedTask.docTitle || '').replace(/[أإآٱ]/g, 'ا').includes('استلام');
          savedTask.badgeText = isReceipt ? 'تم الاستلام' : 'تمت المعالجة';
          savedTask.badgeClass = 'badge-completed';
          // A handled document carries no lateness, whatever its deadline says.
          savedTask.penaltyBand = 'not_late';
          savedTask.penaltyDays = 0;
          closedCount += 1;
        } else {
          // Archived items are excluded from overdue totals and decision counts
          if (!savedTask.isArchived) {
            if (savedTask.urgency === 'overdue') {
              overdueCount += 1;
              todayDecisionCount += 1;
            } else if (savedTask.urgency === 'today' || savedTask.urgency === 'tomorrow' || savedTask.urgency === 'soon') {
              todayDecisionCount += 1;
            }
          }

          // The statutory band is derived from the *stored* daysLeft, so a
          // deadline that moved since the record was written is respected.
          const live = evaluatePenaltyBand(savedTask.daysLeft);
          savedTask.penaltyBand = live.band;
          savedTask.penaltyDays = live.daysOverdue;
          savedTask.penaltyRange = live.statutoryRange;
          savedTask.penaltyBasis = live.basis;
          if (!savedTask.isArchived) {
            if (live.band === 'beyond_60') beyond60Count += 1;
            else if (live.band === 'within_60') within60Count += 1;
          }
        }

        if (savedTask.hasPdf) {
          pdfCount += 1;
        }

        const taskSnapshot = { ...savedTask, isArchived: Boolean(savedTask.isArchived) };
        enrichedTasks.push(taskSnapshot);
      }
    }

    // Save all merged updates
    this.taskStore.save();

    defaultLogger.info(
      `Task Engine processed ${enrichedTasks.length} tasks: ${todayDecisionCount} needing decision, ` +
      `${overdueCount} overdue (${beyond60Count} beyond the 60-day penalty band).`
    );

    return {
      tasks: enrichedTasks,
      stats: {
        total: enrichedTasks.length,
        todayDecisionCount,
        overdueCount,
        closedCount,
        pdfCount,
        // Cost exposure, not a count of documents: how much lateness has already
        // crossed the statutory boundary.
        penaltyWithin60Count: within60Count,
        penaltyBeyond60Count: beyond60Count,
        archivedCount: enrichedTasks.filter(t => t.isArchived).length
      }
    };
  }
}

module.exports = {
  TaskEngine
};
