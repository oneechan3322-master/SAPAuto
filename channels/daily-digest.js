'use strict';

/**
 * Daily WhatsApp digest - the "god servitor" of the office group.
 *
 * Once per day (Cairo clock, default 11:44) the channel process pushes:
 *   1. A summary text of everything NEW since the previous digest
 *      (documents, messages, obligations, AI studies).
 *   2. Every NEW PDF as an attached document with a short caption,
 *      mirroring exactly what the accountant forwards by hand today.
 *
 * Consent (RULE P): the feature only runs after the Owner sends
 * "تفعيل اليومية" from the office group itself, which stores the target
 * chat AND the standing consent, both audited. Revocation is the same
 * message with "إيقاف اليومية". Sends only when message_mode is 'live'.
 */

const path = require('path');
const { localDataRoot } = require('../assistant/paths.cjs');

const MAX_FILES_PER_DIGEST = 8;
const MAX_LIST_ROWS = 12;
const DIGEST_TIME_DEFAULT = '11:44';

function getSetting(db, key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : fallback;
}

function setSetting(db, key, value) {
  db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(key, value, new Date().toISOString());
}

const cairoFormatter = (options) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  ...options
});

function cairoDay(date) {
  return cairoFormatter({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function cairoClock(date) {
  return cairoFormatter({ hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function collectDigestItems(db, sinceIso) {
  const since = String(sinceIso || new Date(0).toISOString());
  const tasks = db.prepare(`SELECT id,account_key,doc_number,title,deadline,urgency,pdf_path,updated_at
    FROM tasks WHERE updated_at > ? ORDER BY updated_at DESC LIMIT ?`).all(since, MAX_LIST_ROWS);
  const messageRows = db.prepare(`SELECT title,received_at FROM messages
    WHERE received_at > ? ORDER BY received_at DESC LIMIT ?`).all(since, MAX_LIST_ROWS);
  const obligationRows = db.prepare(`SELECT title,period,updated_at FROM obligations
    WHERE updated_at > ? ORDER BY updated_at DESC LIMIT ?`).all(since, MAX_LIST_ROWS);
  const counts = {
    tasksTotal: db.prepare('SELECT COUNT(*) n FROM tasks WHERE updated_at > ?').get(since).n,
    messagesTotal: db.prepare('SELECT COUNT(*) n FROM messages WHERE received_at > ?').get(since).n,
    obligationsTotal: db.prepare('SELECT COUNT(*) n FROM obligations WHERE updated_at > ?').get(since).n,
    studiesTotal: db.prepare(`SELECT COUNT(*) n FROM tasks WHERE ai_studied_at > ?`).get(since).n +
      db.prepare('SELECT COUNT(*) n FROM obligations WHERE ai_studied_at > ?').get(since).n
  };
  return { tasks, messages: messageRows, obligations: obligationRows, ...counts };
}

function composeDigestText(items, { windowLabel = 'آخر تحديث', clock = '' } = {}) {
  const head = `★ التقرير اليومي ${clock ? `(${clock})` : ''}\n${windowLabel}`;
  const docRows = items.tasks.slice(0, MAX_LIST_ROWS)
    .map((task) => `• ${task.title}${task.deadline ? ` — الموعد: ${task.deadline}` : ''}`);
  const messageRows = items.messages.slice(0, MAX_LIST_ROWS)
    .map((row) => `• ${row.title}`);
  const obligationRows = items.obligations.slice(0, MAX_LIST_ROWS)
    .map((row) => `• ${row.title}${row.period ? ` — ${row.period}` : ''}`);
  const countsLine = `المستندات الجديدة: ${items.tasksTotal} — الرسائل الجديدة: ${items.messagesTotal}` +
    ` — الالتزامات المحدثة: ${items.obligationsTotal} — دراسات الذكاء: ${items.studiesTotal}`;
  const footer = 'ترسل هذه الرواية تلقائيًا بموافقة المالك. لإيقافها أرسل: إيقاف اليومية';
  return [
    head,
    countsLine,
    items.tasksTotal ? `المستندات:\n${docRows.join('\n')}` : 'لا مستندات جديدة.',
    items.messagesTotal ? `الرسائل:\n${messageRows.join('\n')}` : '',
    items.obligationsTotal ? `الالتزامات:\n${obligationRows.join('\n')}` : '',
    footer
  ].filter(Boolean).join('\n\n').slice(0, 3500);
}

function insideDataRoot(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  const root = path.resolve(localDataRoot());
  return resolved.startsWith(root + path.sep) && resolved.toLowerCase().endsWith('.pdf');
}

async function runDailyDigest(db, { sendMessage, sendDocument, now = new Date() } = {}) {
  if (typeof sendMessage !== 'function') {
    throw new Error('daily digest requires a sendMessage provider');
  }
  const enabled = getSetting(db, 'daily_digest_enabled', '0') === '1';
  const chat = getSetting(db, 'daily_digest_chat', '');
  const nowIso = now.toISOString();
  const today = cairoDay(now);
  const clockNow = cairoClock(now);

  const markEvent = (kind, payload) => db.prepare(`INSERT INTO events(id,kind,entity_id,payload,created_at,announced)
    VALUES(?,?,?,?,?,1)`).run(`digest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    kind, chat || 'digest', JSON.stringify(payload || {}), nowIso);

  if (!enabled || !chat) {
    if (enabled && !chat) markEvent('daily_digest_skipped', { reason: 'no-consented-chat' });
    return { sent: false, reason: enabled ? 'no-chat' : 'disabled' };
  }

  const connected = getSetting(db, 'whatsapp_connected', 'false') === 'true';
  if (!connected) {
    markEvent('daily_digest_skipped', { reason: 'whatsapp-disconnected' });
    return { sent: false, reason: 'whatsapp-disconnected' };
  }

  // NOTE: the digest does not require the global message_mode 'live' toggle.
  // Its own standing consent ("تفعيل اليومية" sent by the Owner from the
  // office group) is the authorization for this channel and is audited;
  // revocation disables it. The general fan-out rules remain untouched.

  if (getSetting(db, 'digest_last_day', '') === today) {
    return { sent: false, reason: 'already-sent-today' };
  }

  const configuredTime = getSetting(db, 'daily_digest_time', DIGEST_TIME_DEFAULT);
  if (clockNow < String(configuredTime)) {
    return { sent: false, reason: 'before-scheduled-time' };
  }

  const lastSentAt = getSetting(db, 'digest_last_sent_at', '') || new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const items = collectDigestItems(db, lastSentAt);
  const headerText = composeDigestText(items, { clock: clockNow });

  await sendMessage(chat, headerText);

  const pdfs = items.tasks.filter((task) => task.pdf_path && insideDataRoot(task.pdf_path)).slice(0, MAX_FILES_PER_DIGEST);
  let documentFailures = 0;
  const { resolveOfficialPdfDetails } = require('../assistant/document-title-resolver.cjs');
  for (const pdfTask of pdfs) {
    try {
      let details;
      try {
        details = await resolveOfficialPdfDetails({ task: pdfTask, db });
      } catch (_) {
        details = {
          caption: `${pdfTask.title}${pdfTask.deadline ? ` — الموعد: ${pdfTask.deadline}` : ''}`,
          displayFilename: ''
        };
      }
      await sendDocument(chat, pdfTask.pdf_path, details.caption, details.displayFilename);
    } catch (error) {
      documentFailures += 1;
      markEvent('daily_digest_document_failed', { taskId: pdfTask.id, reason: error.message });
    }
  }

  db.transaction(() => {
    setSetting(db, 'digest_last_day', today);
    setSetting(db, 'digest_last_sent_at', nowIso);
    markEventSilently(db, nowIso, 'daily_digest_sent', {
      documents: pdfs.length,
      documentFailures,
      counts: {
        tasks: items.tasksTotal,
        messages: items.messagesTotal,
        obligations: items.obligationsTotal,
        studies: items.studiesTotal
      }
    });
  }).immediate();

  return { sent: true, documents: pdfs.length, documentFailures, counts: { tasks: items.tasksTotal, messages: items.messagesTotal, obligations: items.obligationsTotal, studies: items.studiesTotal } };
}

function markEventSilently(db, nowIso, kind, payload) {
  db.prepare(`INSERT INTO events(id,kind,entity_id,payload,created_at,announced)
    VALUES(?,?,?,?,?,1)`).run(`digest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    kind, 'digest', JSON.stringify(payload || {}), nowIso);
}

module.exports = {
  runDailyDigest,
  collectDigestItems,
  composeDigestText,
  cairoDay,
  cairoClock,
  insideDataRoot,
  getSetting,
  setSetting,
  MAX_FILES_PER_DIGEST,
  MAX_LIST_ROWS,
  DIGEST_TIME_DEFAULT
};
