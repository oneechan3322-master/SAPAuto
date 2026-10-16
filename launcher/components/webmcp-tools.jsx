'use client'

import { useEffect, useState } from 'react'

const TARGETS = ['ZETA_MCFAPP', 'ZMCF_PAYROLL']

export default function WebMcpTools() {
  const [state, setState] = useState('checking')
  useEffect(() => {
    const modelContext = document.modelContext
    if (!modelContext || typeof modelContext.registerTool !== 'function') {
      setState('unsupported')
      return
    }

    const controller = new AbortController()
    const tools = [
      {
        name: 'sapauto_get_status',
        title: 'SAPAuto V8 status',
        description: 'Read the authenticated SAPAuto harness health, attention counts, and recent activity.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true },
        execute: async () => {
          const response = await fetch('/api/status', { credentials: 'same-origin', cache: 'no-store' })
          const result = await response.json()
          if (!response.ok) throw new Error(result.error || 'Status unavailable')
          return JSON.stringify(result)
        }
      },
      {
        name: 'sapauto_request_scan_confirmation',
        title: 'Request SAPAuto account scan',
        description: 'Create a pending scan request. An authenticated operator must confirm before the scan is queued.',
        inputSchema: {
          type: 'object',
          properties: { account: { type: 'string', enum: TARGETS } },
          required: ['account'],
          additionalProperties: false
        },
        annotations: { consequentialHint: true },
        execute: async ({ account }) => {
          const response = await fetch('/api/assistant/confirmations', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ toolName: 'scan_now', args: { account } })
          })
          const result = await response.json()
          if (!response.ok) throw new Error(result.error || 'Could not request scan confirmation')
          return JSON.stringify({ confirmationRequired: true, confirmationId: result.id })
        }
      }
    ]
    Promise.all(tools.map((tool) => modelContext.registerTool(tool, { signal: controller.signal })))
      .then(() => setState('registered'))
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error(`WebMCP tool registration failed: ${error.message}`)
          setState('error')
        }
      })
    return () => controller.abort()
  }, [])

  if (state === 'unsupported') return <p className="muted">WebMCP غير مدعوم في هذا المتصفح. استخدم مساعد SAPAuto أدناه.</p>
  if (state === 'error') return <p className="error">تعذر تسجيل أدوات WebMCP في المتصفح.</p>
  return <p className="muted">{state === 'registered' ? 'أدوات WebMCP للقراءة وطلب الفحص مفعّلة لهذا المتصفح.' : 'جارٍ تجهيز أدوات WebMCP…'}</p>
}
