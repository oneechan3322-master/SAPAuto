'use strict'

const { createHash } = require('node:crypto')
const { id, now } = require('../db/queries/shared')
const recordStatus = require('../domain/record-status.cjs')

const cairoDate = (date) => recordStatus.cairoDateKey(date)

function statusLabel(value) {
  const labels = {
    unknown: 'الحالة غير معروفة في المصدر',
    open: 'مفتوح',
    pending: 'قيد الانتظار',
    paid: 'مدفوع وفق السجل',
    done: 'مكتمل',
    submitted: 'مسجل كمقدم في المصدر',
    resolved: 'تمت معالجته',
    payment_due: 'مستحق للسداد',
    overdue: 'متأخر وفق الموعد المسجل',
    not_late: 'غير متأخر وفق بيانات المصدر',
    'في انتظار السداد': 'في انتظار السداد',
    'مستحق السداد': 'مستحق للسداد',
    'تم السداد': 'تم السداد',
    '': 'لم تُسجّل الحالة'
  }
  if (labels[value]) return labels[value]
  if (value && /[\u0600-\u06ff]/.test(value)) return value
  return `حالة أخرى واردة من المصدر: ${value || 'غير محددة'}`
}

function formatDate(value) {
  const day = String(value || '').slice(0, 10)
  if (!recordStatus.validDateKey(day)) return 'الموعد غير متاح'
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeZone: 'UTC' })
    .format(new Date(`${day}T12:00:00Z`))
}

function dueItems(db, today) {
  const items = []
  const tasks = db.prepare(`SELECT id,account_key,title,deadline,status FROM tasks
    WHERE status NOT IN ('done','completed','closed','removed') AND deadline<>''
      AND date(deadline)<=date(?,'+7 days') ORDER BY deadline LIMIT 500`).all(today)
  for (const task of tasks) {
    if (!recordStatus.isOpenRecord('tasks', task.status) || !recordStatus.validDateKey(task.deadline)) continue
    items.push({
      key: `manager:task:${task.id}`, category: 'task_deadline',
      title: `${task.title || 'مهمة دون عنوان'} — موعد ${formatDate(task.deadline)}`,
      details: `الموعد المسجل ${formatDate(task.deadline)}`, accountKey: task.account_key, entityId: task.id
    })
  }
  const obligations = db.prepare(`SELECT id,account_key,title,deadline,status FROM obligations
    WHERE status NOT IN ('done','submitted','resolved','closed') AND deadline<>''
      AND date(deadline)<=date(?,'+7 days') ORDER BY deadline LIMIT 500`).all(today)
  for (const item of obligations) {
    if (recordStatus.statusDisposition('obligations', item.status) === 'complete' ||
        !recordStatus.validDateKey(item.deadline)) continue
    const overdue = item.deadline < today
    const unknown = recordStatus.statusDisposition('obligations', item.status) === 'unknown'
    items.push({
      key: `manager:obligation:${item.id}`,
      category: unknown ? 'obligation_status_unknown' : overdue ? 'obligation_overdue' : 'obligation_deadline',
      title: unknown
        ? `تحقق من حالة ${item.title || 'الالتزام'}`
        : `${item.title || 'التزام دون عنوان'} — ${overdue ? 'تجاوز الموعد' : 'موعد'} ${formatDate(item.deadline)}`,
      details: `${statusLabel(item.status)}؛ الموعد المسجل ${formatDate(item.deadline)}`,
      accountKey: item.account_key, entityId: item.id
    })
  }
  const payments = db.prepare(`SELECT id,account_key,claim_number,amount,currency,due_date,status FROM payments
    WHERE status NOT IN ('paid','done','complete','completed','resolved','settled','closed') AND due_date<>''
      AND date(due_date)<=date(?,'+7 days') ORDER BY due_date LIMIT 500`).all(today)
  for (const payment of payments) {
    const disposition = recordStatus.statusDisposition('payments', payment.status)
    if (disposition === 'complete' || !recordStatus.validDateKey(payment.due_date)) continue
    const overdue = payment.due_date < today
    const unknown = disposition === 'unknown'
    items.push({
      key: `manager:payment:${payment.id}`,
      category: unknown ? 'payment_status_unknown' : overdue ? 'payment_overdue' : 'payment_due',
      title: unknown ? 'تحقق من حالة الدفع المسجلة' : `${overdue ? 'راجع موعد السداد' : 'موعد السداد قريب'} — ${formatDate(payment.due_date)}`,
      details: `${recordStatus.formatAmount(payment.amount, payment.currency)}؛ ${statusLabel(payment.status)}؛ الموعد ${formatDate(payment.due_date)}`,
      accountKey: payment.account_key, entityId: payment.id
    })
  }
  return items
}

function attentionItems(db, currentTime = Date.now()) {
  const items = dueItems(db, cairoDate(new Date(currentTime)))
  const heartbeat = db.prepare('SELECT last_heartbeat FROM harness_status WHERE id=1').get()
  if (heartbeat?.last_heartbeat && currentTime - Date.parse(heartbeat.last_heartbeat) > 180000) {
    items.push({
      key: 'manager:harness:offline', category: 'harness_offline',
      title: 'محرك الفحص غير متصل', details: 'لم يصل نبض خلال أكثر من ثلاث دقائق.'
    })
  }
  const failures = db.prepare(`SELECT f.account_key,COUNT(*) AS count,MAX(f.occurred_at) AS latest,
    MAX(f.reason) AS reason FROM failures f
    WHERE f.resolved_at IS NULL GROUP BY f.account_key LIMIT 500`).all()
  for (const failure of failures) items.push({
    key: `manager:failure:${failure.account_key}`, category: 'account_failure',
    title: `إخفاقات الحساب ${failure.account_key} (${failure.count})`,
    details: failure.reason || 'تحقق من بيانات الحساب واتصاله.',
    accountKey: failure.account_key
  })
  return items
}

function attentionId(key) {
  return `attention_${createHash('sha256').update(key).digest('hex').slice(0, 24)}`
}

function synchronizeAttention(db, items, timestamp = now()) {
  const activeKeys = new Set(items.map((item) => item.key))
  const upsert = db.prepare(`INSERT INTO assistant_attention
    (id,dedupe_key,category,title,details,account_key,entity_id,state,created_at,updated_at)
    VALUES(@id,@key,@category,@title,@details,@accountKey,@entityId,'open',@timestamp,@timestamp)
    ON CONFLICT(dedupe_key) DO UPDATE SET category=excluded.category,title=excluded.title,
      details=excluded.details,account_key=excluded.account_key,entity_id=excluded.entity_id,
      state='open',updated_at=excluded.updated_at`)
  const createEvent = db.prepare(`INSERT INTO events(id,kind,account_key,entity_id,payload,created_at)
    VALUES(?,?,?,?,?,?)`)
  const open = db.prepare("SELECT state FROM assistant_attention WHERE dedupe_key=?")
  for (const item of items) {
    const previous = open.get(item.key)
    upsert.run({ id: attentionId(item.key), ...item, accountKey: item.accountKey || '',
      entityId: item.entityId || '', timestamp })
    if (!previous || previous.state !== 'open') {
      createEvent.run(id('event'), 'assistant_attention', item.accountKey || '',
        attentionId(item.key), JSON.stringify({ category: item.category, title: item.title, details: item.details }), timestamp)
    }
  }
  const clear = db.prepare("UPDATE assistant_attention SET state='cleared',updated_at=? WHERE id=? AND state='open'")
  for (const item of db.prepare("SELECT id,dedupe_key FROM assistant_attention WHERE state='open' AND dedupe_key LIKE 'manager:%'").all()) {
    if (!activeKeys.has(item.dedupe_key)) clear.run(timestamp, item.id)
  }
  return items.length
}

function runAttentionCycle(db, currentTime = Date.now()) {
  const transaction = db.transaction(() => {
    const items = attentionItems(db, currentTime)
    const count = synchronizeAttention(db, items)
    db.prepare(`UPDATE assistant_manager_status SET state='online',last_run_at=?,last_error='',updated_at=? WHERE id=1`)
      .run(now(), now())
    return count
  })
  try {
    return transaction()
  } catch (error) {
    db.prepare(`UPDATE assistant_manager_status SET state='error',last_error=?,updated_at=? WHERE id=1`)
      .run(String(error.message || error).slice(0, 1000), now())
    throw error
  }
}

module.exports = { attentionItems, runAttentionCycle, synchronizeAttention }
