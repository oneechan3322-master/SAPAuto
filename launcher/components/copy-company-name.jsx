'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/**
 * Plan 2.4 §3.2 — the full legal name must be available in an accessible label
 * *and* a copy action, so an accountant can paste it into a filing or an email
 * without retyping (retyping is where names get corrupted).
 */
export default function CopyCompanyName({ name, englishName, compact = false }) {
  const [copied, setCopied] = useState('')
  if (!name) return null

  const options = [
    { id: 'ar', label: 'الاسم العربي', value: name },
    ...(englishName ? [{ id: 'en', label: 'الاسم الإنجليزي', value: englishName }] : []),
    ...(englishName ? [{ id: 'both', label: 'الاسمان', value: `${name} · ${englishName}` }] : [])
  ]

  async function copy(option) {
    try {
      await navigator.clipboard.writeText(option.value)
      setCopied(option.id)
      setTimeout(() => setCopied(''), 2000)
    } catch {
      setCopied('error')
      setTimeout(() => setCopied(''), 3000)
    }
  }

  return (
    <div className={`copy-name ${compact ? 'is-compact' : ''}`}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className="copy-name-button"
          aria-label={`نسخ ${option.label} كاملًا`}
          title={`نسخ ${option.label} كاملًا`}
          onClick={() => copy(option)}
        >
          {copied === option.id
            ? <><Check size={13} aria-hidden="true" /> تم النسخ</>
            : <><Copy size={13} aria-hidden="true" /> {option.id === 'ar' ? 'نسخ الاسم' : option.id === 'en' ? 'نسخ الاسم الإنجليزي' : 'نسخ الاسمين'}</>}
        </button>
      ))}
      {copied === 'error' && <span className="copy-name-error" role="alert">تعذر النسخ؛ حدّد النص وانسخه يدويًا.</span>}
    </div>
  )
}