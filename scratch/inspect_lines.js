'use strict'
const fs = require('node:fs')
const content = fs.readFileSync(String.raw`c:\Users\Mega Store\Downloads\SapAuto\v8\channels\events.js`, 'utf8')
const lines = content.split('\n')
for (let i = 170; i < 183; i++) {
  console.log(i+1, JSON.stringify(lines[i]))
}
