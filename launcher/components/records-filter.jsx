export default function RecordsFilter({ section, companies = [], query = '', company = '' }) {
  const supportsCompanyFilter = ['tasks', 'obligations', 'payments', 'messages', 'failures', 'reminders', 'reports'].includes(section)
  if (section !== 'companies' && !supportsCompanyFilter) {
    return <p className="records-filter-note">لا تتضمن هذه السجلات ارتباطًا محفوظًا بشركة، لذلك لم نضع اسمًا بالتخمين.</p>
  }

  const knownCompanies = companies.filter((item) => item.company_known)
  const hasUnknownCompanies = companies.some((item) => !item.company_known)
  return (
    <form className="records-filter" action={`/${section}`} method="get">
      <label>
        {section === 'companies' ? 'ابحث عن شركة بالاسم أو رقم التسجيل' : 'ابحث باسم الشركة أو رقم تسجيلها'}
        <input
          type="search"
          name="q"
          maxLength={160}
          value={query}
          placeholder="اكتب اسم الشركة أو رقم تسجيلها"
        />
      </label>
      {supportsCompanyFilter && (
        <label>
          الشركة
          <select name="company" defaultValue={company}>
            <option value="">كل الشركات</option>
            {knownCompanies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}{item.english_name ? ` · ${item.english_name}` : ''}
              </option>
            ))}
            {hasUnknownCompanies && <option value="unknown">شركات بلا اسم مسجّل</option>}
          </select>
        </label>
      )}
      <button className="button-primary" type="submit">عرض النتائج</button>
      {(query || company) && <a className="button-secondary" href={`/${section}`}>مسح البحث</a>}
    </form>
  )
}
