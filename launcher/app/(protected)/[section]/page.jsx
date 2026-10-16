import { notFound } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import RecordsView from '../../../components/records-view.jsx'
import MessagesView from '../../../components/messages-view.jsx'
import RecordsFilter from '../../../components/records-filter.jsx'
import ExportControls from '../../../components/export-controls.jsx'
import { listRecords, truncationOf } from '../../../lib/data.js'
import { numberLocale } from '../../../lib/display.js'

const titles = {
  companies: 'الشركات', tasks: 'المهام', obligations: 'الالتزامات',
  payments: 'المدفوعات', messages: 'الرسائل', failures: 'الإخفاقات',
  reminders: 'التذكيرات', reports: 'التقارير', audit: 'سجل التدقيق'
}

export default async function RecordsPage({ params, searchParams }) {
  const [{ section }, search] = await Promise.all([params, searchParams])
  if (!titles[section]) notFound()
  const locale = await numberLocale()
  const query = typeof search?.q === 'string' ? search.q.trim().slice(0, 160) : ''
  const selectedCompany = typeof search?.company === 'string' ? search.company : ''
  const allRows = listRecords(section)
  // Plan 2.4 §5.2 — read truncation before filtering; a filtered view of a
  // capped list must still say so, and must show the real total.
  const truncation = truncationOf(allRows)
  const companies = section === 'companies' ? allRows : listRecords('companies')
  const rows = allRows.filter((row) => {
    if (selectedCompany === 'unknown' && row.company_known) return false
    if (selectedCompany && selectedCompany !== 'unknown' && row.company_id !== selectedCompany) return false
    if (!query) return true
    const searchable = section === 'companies'
      ? [row.name, row.english_name, row.tax_registration_number]
      : [row.company_name, row.company_english_name, row.company_tax_registration_number]
    return searchable.some((value) => String(value || '').toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  })
  const filter = <RecordsFilter
    section={section}
    companies={companies}
    query={query}
    company={selectedCompany}
  />
  if (section === 'messages') {
    return (
      <div className="stack">
        {filter}
        <ExportControls section={section} query={query} company={selectedCompany} companies={companies} />
        <MessagesView rows={rows.map(({ company_tax_registration_number: _taxNumber, ...message }) => message)} />
      </div>
    )
  }
  return (
    <div className="stack">
      {filter}
      <ExportControls section={section} query={query} company={selectedCompany} companies={companies} />
      <div className="page-heading">
        <div>
          <h1>{titles[section]}</h1>
          {section === 'companies' && <p className="muted">مساحة خاصة بكل شركة، مع لمحة سريعة عمّا ينتظر انتباهك.</p>}
          {section === 'tasks' && <p className="muted">خطواتك القادمة، مرتبة حسب المواعيد وما يحتاج اهتمامك.</p>}
          {section === 'obligations' && <p className="muted">التزاماتك ومواعيدها في لمحة واضحة وهادئة.</p>}
          {section === 'payments' && <p className="muted">المبالغ ومواعيدها، مع تنبيه لطيف لما يستحق المراجعة.</p>}
        </div>
        {section !== 'companies' && (
          <span className="tag">
            {rows.length === truncation?.total
              ? `${rows.length.toLocaleString(locale)} عنصر`
              : `${rows.length.toLocaleString(locale)} معروض من ${(truncation?.total ?? rows.length).toLocaleString(locale)}`}
          </span>
        )}
      </div>
      {truncation?.truncated && (
        <p className="record-truncation-notice" role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          نعرض {rows.length.toLocaleString(locale)} من أصل {truncation.total.toLocaleString(locale)} سجلًا كحدّ العرض.
          هذه القائمة ليست كاملة؛ صدّرها أو رشّحها لرؤية ما خلف الحد.
        </p>
      )}
      <RecordsView section={section} rows={rows} companyOptions={companies} locale={locale} truncation={truncation} />
    </div>
  )
}
