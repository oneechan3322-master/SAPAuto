'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import CopyCompanyName from './copy-company-name.jsx'

export default function CompanyIdentityForm({
  companyId,
  name,
  englishName,
  taxRegistrationNumber,
  identityOrigin,
  portalName
}) {
  const router = useRouter()
  const [arabicName, setArabicName] = useState(name || '')
  const [latinName, setLatinName] = useState(englishName || '')
  const [taxNumber, setTaxNumber] = useState(taxRegistrationNumber || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const unnamed = !name
  const hasConflict = identityOrigin === 'conflict'
  const unverifiedMapping = identityOrigin === 'unverified_mapping'

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: arabicName,
          englishName: latinName,
          taxRegistrationNumber: taxNumber
        })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'تعذر حفظ بيانات الشركة.')
      setArabicName(result.company.name)
      setLatinName(result.company.english_name)
      setTaxNumber(result.company.tax_registration_number)
      setNotice(result.company.name_origin === 'conflict'
        ? 'حُفظ الاسم، لكنّه لا يطابق الاسم الوارد من البوابة. راجع الاسمين قبل الاعتماد.'
        : 'تم حفظ الاسم ورقم التسجيل كما أدخلتهما، وسجّلنا ذلك في سجل التدقيق.')
      router.refresh()
    } catch (caught) {
      setError(caught.message || 'تعذر حفظ بيانات الشركة.')
    } finally {
      setBusy(false)
    }
  }

  async function copyTaxNumber() {
    setError('')
    try {
      await navigator.clipboard.writeText(taxNumber)
      setNotice('تم نسخ رقم التسجيل الضريبي.')
    } catch {
      setError('تعذر النسخ من هذا المتصفح. حدّد الرقم وانسخه يدويًا.')
    }
  }

  return (
    <section className="company-identity-panel" aria-labelledby="company-identity-title">
      <div>
        <span className="eyebrow">
          {hasConflict ? 'الاسمان لا يتطابقان' : unverifiedMapping ? 'اسم محفوظ يحتاج إلى تأكيد' : unnamed ? 'لم يصلنا اسم من البوابة' : 'بيانات محفوظة'}
        </span>
        <h2 id="company-identity-title">
          {hasConflict ? 'راجع اسم الشركة' : unverifiedMapping ? 'تأكيد بيانات الشركة' : unnamed ? 'تعيين اسم الشركة' : 'اسم الشركة ورقم تسجيلها'}
        </h2>
        <p className="muted">
          {hasConflict
            ? 'الاسم الذي أدخلته يختلف عن اسم البوابة. اختر الاسم الصحيح كما يظهر في مستند رسمي؛ لن نعتمد أحدهما بدلًا من الآخر تلقائيًا.'
            : unverifiedMapping
              ? 'هذا الاسم محفوظ من سجل قديم، لكن مصدره غير مؤكد. راجعه في مستند رسمي قبل حفظه واعتماده.'
              : unnamed
                ? 'اسمها غير مسجّل. أدخل الاسم كما يظهر في مستند رسمي؛ لن نخمّنه، وما تكتبه يُحفظ بوصفه «أدخلته أنت» ولا تغيّره المزامنة.'
                : 'لا نستنتج هذه البيانات من رقم الحساب. عدّل الاسم أو الرقم كما يظهر في مستند رسمي.'}
        </p>
        {hasConflict && portalName && (
          <div className="company-identity-conflict" role="status">
            <strong>اسم البوابة</strong>
            <span dir="auto">{portalName}</span>
            <button className="button-secondary" type="button" onClick={() => setArabicName(portalName)}>
              استخدام اسم البوابة
            </button>
          </div>
        )}
        {!unnamed && <p className="company-origin-note">أي تعديل تحفظه يُسجَّل في سجل التدقيق.</p>}
      </div>
      <form className="company-identity-form" onSubmit={save}>
        {!unnamed && (
          <div className="company-identity-copy">
            <span className="company-identity-copy-label">انسخ الاسم كما هو:</span>
            <CopyCompanyName name={arabicName || name} englishName={latinName || englishName} />
          </div>
        )}
        <label>
          الاسم العربي
          <input
            autoComplete="organization"
            maxLength={160}
            required
            value={arabicName}
            onChange={(event) => setArabicName(event.target.value)}
          />
        </label>
        <label>
          الاسم الإنجليزي، إن وجد
          <input
            autoComplete="organization"
            dir="ltr"
            maxLength={160}
            value={latinName}
            onChange={(event) => setLatinName(event.target.value)}
          />
        </label>
        <label>
          رقم التسجيل الضريبي
          {!taxNumber && <small className="company-identity-hint">لم يتم تسجيله بعد. أضفه كما يظهر في مستند رسمي.</small>}
          <span className="company-tax-entry">
            <input
              autoComplete="off"
              dir="ltr"
              inputMode="numeric"
              maxLength={30}
              pattern="[0-9]{1,30}"
              value={taxNumber}
              onChange={(event) => setTaxNumber(event.target.value)}
            />
            {taxNumber && <button className="button-secondary" type="button" onClick={copyTaxNumber}>نسخ الرقم</button>}
          </span>
        </label>
        {error && <p className="notice-error" role="alert">{error}</p>}
        {notice && <p className="notice-success" role="status">{notice}</p>}
        <button className="button-primary" disabled={busy} type="submit">
          {busy ? 'جارٍ الحفظ…' : unnamed ? 'حفظ الاسم' : unverifiedMapping ? 'تأكيد الاسم وحفظه' : 'حفظ بيانات الشركة'}
        </button>
      </form>
    </section>
  )
}
