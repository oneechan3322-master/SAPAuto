export default function ExportControls({ section, query = '', company = '', companies = [], companyId = '' }) {
  const knownCompanies = companies.filter((item) => item.company_known)
  const hasUnknownCompanies = companies.some((item) => !item.company_known)
  const showCompanySelection = section !== 'companies' && ['tasks', 'obligations', 'payments', 'messages', 'failures', 'reminders', 'reports'].includes(section)
  const showDateRange = section !== 'companies'
  const currentParams = new URLSearchParams({ section })
  if (query) currentParams.set('q', query)
  if (company) currentParams.set('company', company)
  if (companyId) currentParams.set('companyId', companyId)

  return (
    <section className="export-controls" aria-label="تصدير السجلات">
      <form action="/api/export" method="get">
        {[...currentParams.entries()].map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <button className="button-secondary" type="submit">تصدير النتائج الحالية إلى Excel</button>
      </form>
      <details className="export-custom">
        <summary>خيارات تصدير أخرى</summary>
        <form action="/api/export" method="get" className="export-custom-form">
          <input type="hidden" name="section" value={section} />
          {companyId && <input type="hidden" name="companyId" value={companyId} />}
          {showCompanySelection && (
            <fieldset>
              <legend>الشركات (اتركها دون تحديد لتصدير الكل)</legend>
              {knownCompanies.map((item) => (
                <label key={item.id}>
                  <input type="checkbox" name="companyId" value={item.id} />
                  <span>{item.name}{item.english_name ? ` · ${item.english_name}` : ''}</span>
                </label>
              ))}
              {hasUnknownCompanies && (
                <label><input type="checkbox" name="companyId" value="unknown" /><span>الشركات غير المعروفة</span></label>
              )}
            </fieldset>
          )}
          {showDateRange && (
            <div className="export-date-range">
              <label>من تاريخ<input type="date" name="from" /></label>
              <label>إلى تاريخ<input type="date" name="to" /></label>
            </div>
          )}
          <button className="button-primary" type="submit">تنزيل ملف Excel</button>
        </form>
      </details>
    </section>
  )
}
