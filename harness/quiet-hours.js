'use strict'

function minutesUntilQuietEnd(value, date = new Date()) {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error('quiet_hours must use HH:MM-HH:MM')
  const [, startHour, startMinute, endHour, endMinute] = match.map(Number)
  if ([startHour, endHour].some((hour) => hour > 23) ||
      [startMinute, endMinute].some((minute) => minute > 59)) {
    throw new Error('quiet_hours contains an invalid time')
  }
  const start = startHour * 60 + startMinute
  const end = endHour * 60 + endMinute
  if (start === end) throw new Error('quiet_hours start and end must differ')
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date)
  const current = Number(parts.find((part) => part.type === 'hour').value) * 60 +
    Number(parts.find((part) => part.type === 'minute').value)
  const quiet = start < end ? current >= start && current < end : current >= start || current < end
  if (!quiet) return 0
  return (end - current + 1440) % 1440
}

function nextCycleTime(date, intervalMinutes, quietHours) {
  const next = new Date(date.getTime() + intervalMinutes * 60000)
  const quietRemaining = minutesUntilQuietEnd(quietHours, next)
  if (quietRemaining) next.setTime(next.getTime() + quietRemaining * 60000)
  return next
}

module.exports = { minutesUntilQuietEnd, nextCycleTime }
