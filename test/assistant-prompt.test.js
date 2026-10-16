'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const prompt = require('../assistant/prompt')

test('assistant prompt does not instruct the model to shorten answers', () => {
  assert.doesNotMatch(prompt, /باختصار/)
  assert.match(prompt, /بالتفصيل المناسب للسؤال/)
})
