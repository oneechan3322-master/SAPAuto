'use strict'
const path = require('node:path')
const { localDataRoot } = require('../assistant/paths.cjs')

const filePath = 'C:\\Users\\Mega Store\\Downloads\\SapAuto\\v8\\data\\pdfs\\ملاحظات قبول-٩٣٣٠٠٠٠٢٨١٣٨.PDF'
const resolved = path.resolve(filePath)
const root = path.resolve(localDataRoot())
const sep = path.sep

console.log('resolved:', JSON.stringify(resolved))
console.log('root    :', JSON.stringify(root))
console.log('sep     :', JSON.stringify(sep))
console.log('root+sep:', JSON.stringify(root + sep))
console.log('startsWith:', resolved.startsWith(root + sep))
console.log('startsWith (no sep):', resolved.startsWith(root))
// Check if root itself ends with sep
console.log('root ends with sep:', root.endsWith(sep))
