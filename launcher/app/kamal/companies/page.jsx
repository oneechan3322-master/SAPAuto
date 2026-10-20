'use client'

import { useEffect } from 'react'

export default function KamalCompaniesPage() {
  useEffect(() => {
    document.body.classList.add('kamal-mode')
    return () => {
      document.body.classList.remove('kamal-mode')
    }
  }, [])

  return (
    <main className="kamal-mode" dir="rtl">
      <div className="kamal-ambient" style={{ top: '20%', left: '8%' }} />
      <div className="kamal-ambient" style={{ bottom: '10%', right: '12%' }} />
      
      <div style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '32px', marginBottom: '24px', color: 'var(--text)' }}>
          وضع كمال - الشركات
        </h1>
        <p style={{ color: 'var(--text-3)', marginBottom: '32px' }}>
          واجهة مركزة للشركات مع إضاءة خلفية أنيقة
        </p>
        
        <div className="panel" style={{ padding: '32px' }}>
          <p style={{ color: 'var(--text-2)' }}>
            محتوى الشركات سيتم إضافته هنا
          </p>
        </div>
      </div>
    </main>
  )
}
