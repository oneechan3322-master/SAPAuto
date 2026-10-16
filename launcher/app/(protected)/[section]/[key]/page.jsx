import { notFound } from 'next/navigation'
import { Building2 } from 'lucide-react'
import RecordsView from '../../../../components/records-view.jsx'
import CompanyIdentityForm from '../../../../components/company-identity-form.jsx'
import ExportControls from '../../../../components/export-controls.jsx'
import { getCompanyRecords } from '../../../../lib/data.js'
import identity from '../../../../../domain/company-identity.cjs'
import { numberLocale } from '../../../../lib/display.js'

const titles = { tasks: 'المهام', obligations: 'الالتزامات', payments: 'المدفوعات', messages: 'الرسائل' }

export default async function CompanyPage({ params }) {
  const { section, key } = await params
  if (section !== 'companies') notFound()
  const result = getCompanyRecords(decodeURIComponent(key))
  if (!result) notFound()
  const locale = await numberLocale()
  const company = identity.resolveCompanyIdentity(result.company)
  return (
    <div className="stack">
      <header className="company-detail-head">
        <span className={`company-avatar company-avatar-large ${company.known ? '' : 'is-empty'}`} aria-hidden="true">
          {companyInitialsOf(company) || <Building2 size={26} strokeWidth={1.6} />}
        </span>
        <div>
          <h1 className="company-name-full" title={company.name}>
            {company.origin === 'conflict' ? 'راجع اسم الشركة' : company.origin === 'unverified_mapping' ? 'اسم محفوظ يحتاج إلى تأكيد' : company.name}
          </h1>
          {company.origin === 'conflict'
            ? <p className="muted">الاسم الذي أدخلته: <strong>{company.manualName}</strong> · اسم البوابة: <strong>{company.portalName}</strong></p>
            : company.origin === 'unverified_mapping'
              ? <p className="muted">الاسم المحفوظ: <strong>{company.name}</strong>. لم يتم تأكيده من مستند رسمي بعد.</p>
              : company.known
                ? <p className="muted">مساحة خاصة بمهام الشركة والتزاماتها ومواعيدها.</p>
                : <p className="muted">لا نعرف اسم هذه الشركة بعد. لن نخمّنه؛ أدخله كما يظهر في مستند رسمي.</p>}
          {company.englishName && <p className="muted" dir="ltr" title={company.englishName}>{company.englishName}</p>}
          <p className="company-origin-note">
            {company.origin === 'manual_verified'
              ? 'الاسم الحالي أدخلته أنت، ومزامنة البوابة لا تغيّره.'
              : company.origin === 'portal_verified'
                ? 'الاسم كما أرسلته البوابة في آخر مزامنة.'
                : company.origin === 'conflict'
                  ? 'يوجد اختلاف بين الاسم الذي أدخلته واسم البوابة. لن نعتمد أحدهما تلقائيًا.'
                  : company.origin === 'unverified_mapping'
                    ? 'هذا الاسم من سجل قديم؛ يحتاج إلى تأكيد يدوي قبل اعتماده.'
                    : 'لا يوجد اسم محفوظ لهذه الشركة.'}
          </p>
        </div>
      </header>
      <div id="set-company-name">
        <CompanyIdentityForm
          companyId={result.company.id}
          name={company.known || company.origin === 'conflict' || company.origin === 'unverified_mapping' ? company.name : ''}
          englishName={company.englishName}
          taxRegistrationNumber={company.taxRegistrationNumber}
          identityOrigin={company.origin}
          portalName={company.portalName}
        />
      </div>
      <ExportControls section="company" companyId={result.company.id} />
      {Object.entries(titles).map(([name, title]) => (
        <section className="stack" key={name}>
          <h2>{title}</h2>
          <RecordsView section={name} rows={result.rows[name]} locale={locale} />
        </section>
      ))}
    </div>
  )
}

function companyInitialsOf(company) {
  return company.known ? identity.companyInitials(company.name) : ''
}
