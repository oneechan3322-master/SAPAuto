'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function CompanyAssignment({ section, recordId, companies = [] }) {
  const router = useRouter()
  const knownCompanies = companies.filter((company) => company.company_known)
  const [companyId, setCompanyId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function linkCompany(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setBusy(true)
    try {
      const response = await fetch('/api/records/company-link', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ section, recordId, companyId })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'تعذر ربط السجل بالشركة.')
      setSuccess(`تم ربط السجل بـ ${result.companyName}.`)
      router.refresh()
    } catch (caught) {
      setError(caught.message || 'تعذر ربط السجل بالشركة.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="company-assignment">
      <summary>ربط الشركة يدويًا</summary>
      {knownCompanies.length ? (
        <form onSubmit={linkCompany}>
          <label>
            اختر الشركة
            <select required value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
              <option value="">اختر من الأسماء التي تم توثيقها</option>
              {knownCompanies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}{company.english_name ? ` · ${company.english_name}` : ''}
                </option>
              ))}
            </select>
          </label>
          <button className="button-primary" type="submit" disabled={busy || !companyId}>
            {busy ? 'جارٍ الربط…' : 'حفظ الربط'}
          </button>
        </form>
      ) : (
        <p>أضف اسمًا موثّقًا من صفحة الشركات أولًا، ثم ارجع لإكمال الربط.</p>
      )}
      {error && <p className="notice-error" role="alert">{error}</p>}
      {success && <p className="notice-success" role="status">{success}</p>}
    </details>
  )
}
