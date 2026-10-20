'use strict'
// This script simulates what channels/index.js does when processing wake_send_document
const path = require('node:path')

// Simulate being in the channels directory (as if __dirname = channels/)
const channelsDir = path.join(__dirname, '..', 'channels')
const assistantPathsCjs = path.join(__dirname, '..', 'assistant', 'paths.cjs')

// Load paths.cjs from its actual location (which uses __dirname = assistant/)
const { localDataRoot } = require(assistantPathsCjs)

const pdfPath = 'C:\\Users\\Mega Store\\Downloads\\SapAuto\\v8\\data\\pdfs\\ملاحظات قبول-٩٣٣٠٠٠٠٢٨١٣٨.PDF'
const resolved = path.resolve(pdfPath)
const root = path.resolve(localDataRoot())

console.log('localDataRoot():', localDataRoot())
console.log('root (resolved):', root)
console.log('resolved file  :', resolved)
console.log('root + sep     :', root + path.sep)
console.log('startsWith     :', resolved.startsWith(root + path.sep))

// Check for case sensitivity or unicode normalization issues
console.log('\nresolved length:', resolved.length)
console.log('root+sep length:', (root + path.sep).length)
console.log('first 60 chars resolved:', JSON.stringify(resolved.slice(0, 60)))
console.log('first 60 chars root+sep:', JSON.stringify((root + path.sep).slice(0, 60)))
