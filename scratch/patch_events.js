'use strict'
const fs = require('node:fs')
const filePath = String.raw`c:\Users\Mega Store\Downloads\SapAuto\v8\channels\events.js`
let content = fs.readFileSync(filePath, 'utf8')

const OLD = `    if (mode === 'sent') await providers[link.channel](link.external_id, text)\r
    db.prepare('INSERT INTO channel_deliveries(event_id,channel,external_id,sent_at,status) VALUES(?,?,?,?,?)')\r
      .run(event.id, link.channel, link.external_id, now(), mode)\r
  }\r`

const NEW = `    let deliveryStatus = mode\r
    if (mode === 'sent') {\r
      try {\r
        await providers[link.channel](link.external_id, text)\r
      } catch (sendErr) {\r
        console.error(\`Delivery failed for event \${event.id} via \${link.channel}: \${sendErr.message}\`)\r
        deliveryStatus = 'failed'\r
      }\r
    }\r
    db.prepare('INSERT INTO channel_deliveries(event_id,channel,external_id,sent_at,status) VALUES(?,?,?,?,?)')\r
      .run(event.id, link.channel, link.external_id, now(), deliveryStatus)\r
  }\r`

if (!content.includes(OLD)) {
  console.error('TARGET NOT FOUND!')
  process.exit(1)
}

content = content.replace(OLD, NEW)
fs.writeFileSync(filePath, content, 'utf8')
console.log('SUCCESS: events.js patched')
