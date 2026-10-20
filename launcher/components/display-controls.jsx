'use client'

import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

const DIGITS_COOKIE = 'sapauto_digits'
const THEME_KEY = 'sapauto.theme'

/**
 * Theme follows the system setting until the user picks light or dark here.
 * Digits: Western (0-9) by default, Arabic-Indic (٠-٩) on request. The
 * choice is a cookie so the server renders the same digits on first paint.
 */
export default function DisplayControls() {
  const [theme, setTheme] = useState('system')
  const [digits, setDigits] = useState('latn')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const stored = document.documentElement.dataset.theme
    setTheme(stored === 'light' || stored === 'dark' ? stored : 'system')
    if (!stored) {
      document.body.classList.add('kamal-mode')
    }
    const match = document.cookie.match(new RegExp(`${DIGITS_COOKIE}=(\\w+)`))
    setDigits(match?.[1] === 'arab' ? 'arab' : 'latn')
    setReady(true)
  }, [])

  function chooseTheme(next) {
    setTheme(next)
    if (next === 'system') {
      delete document.documentElement.dataset.theme
      document.body.classList.add('kamal-mode')
      try { localStorage.removeItem(THEME_KEY) } catch { /* ignore */ }
      return
    }
    document.documentElement.dataset.theme = next
    document.body.classList.remove('kamal-mode')
    try { localStorage.setItem(THEME_KEY, next) } catch { /* ignore */ }
  }

  function chooseDigits(next) {
    setDigits(next)
    document.cookie = `${DIGITS_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
  }

  const themes = [
    ['system', 'Cyber', Monitor],
    ['light', 'فاتح', Sun],
    ['dark', 'داكن', Moon]
  ]

  return (
    <div className="display-controls">
      <span className="display-caption">المظهر</span>
      <div className="display-controls-row" role="group" aria-label="سمة الألوان">
        {themes.map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            className={`display-chip ${ready && theme === value ? 'is-on' : ''}`}
            aria-pressed={ready && theme === value}
            onClick={() => chooseTheme(value)}
          >
            <Icon size={13} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <span className="display-caption">الأرقام</span>
      <div className="display-controls-row" role="group" aria-label="نظام الأرقام">
        <button
          type="button"
          className={`display-chip ${ready && digits === 'latn' ? 'is-on' : ''}`}
          aria-pressed={ready && digits === 'latn'}
          onClick={() => chooseDigits('latn')}
        >
          0-9
        </button>
        <button
          type="button"
          className={`display-chip ${ready && digits === 'arab' ? 'is-on' : ''}`}
          aria-pressed={ready && digits === 'arab'}
          onClick={() => chooseDigits('arab')}
        >
          ٠-٩
        </button>
      </div>
    </div>
  )
}