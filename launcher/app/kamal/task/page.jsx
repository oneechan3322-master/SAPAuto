'use client'

import { useEffect } from 'react'

export default function KamalTaskPage() {
  useEffect(() => {
    document.body.classList.add('kamal-mode')
    return () => {
      document.body.classList.remove('kamal-mode')
    }
  }, [])

  return (
    <main className="kamal-mode" dir="rtl">
      <div className="kamal-ambient" style={{ top: '10%', right: '10%' }} />
      <div className="kamal-ambient" style={{ bottom: '15%', left: '5%' }} />
      
      <div style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '32px', marginBottom: '24px', color: 'var(--text)' }}>
          وضع كمال - المهام
        </h1>
        <p style={{ color: 'var(--text-3)', marginBottom: '32px' }}>
          واجهة مركزة للعمل مع إضاءة خلفية أنيقة
        </p>
        
        <div className="panel" style={{ padding: '32px' }}>
          <p style={{ color: 'var(--text-2)' }}>
            محتوى المهام سيتم إضافته هنا
          </p>
        </div>
      </div>
    </main>
  )
}
