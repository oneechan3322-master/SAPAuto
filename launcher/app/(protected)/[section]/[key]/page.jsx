import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Building2 } from 'lucide-react'
import RecordsView from '../../../../components/records-view.jsx'
import CompanyIdentityForm from '../../../../components/company-identity-form.jsx'
import CompanyDocumentsCard from '../../../../components/company-documents-card.jsx'
import ExportControls from '../../../../components/export-controls.jsx'
import { getCompanyRecords, readPayrollData } from '../../../../lib/data.js'
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
  const payroll = readPayrollData(result.company.account_key || result.company.name)
  const payrollAccount = payroll.matchedAccount

  return (
    <div className="stack">
      <header className="company-detail-head">
        <span className={`company-avatar company-avatar-large ${company.known ? '' : 'is-empty'}`} aria-hidden="true">
          {companyInitialsOf(company) || <Building2 size={26} strokeWidth={1.6} />}
        </span>
        <div>
          <h1 className="company-name-full" title={company.name}>
            {company.origin === 'conflict' ? 'راجع اسم الشركة' : company.name}
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
      <CompanyDocumentsCard companyId={result.company.id} initialDocuments={result.rows.documents || []} />
      {Object.entries(titles).map(([name, title]) => (
        <section className="stack" key={name}>
          <h2>{title}</h2>
          <RecordsView section={name} rows={result.rows[name]} locale={locale} />
        </section>
      ))}

      <section className="stack mt-6" id="company-payroll">
        <div className="flex items-center justify-between">
          <h2>الرواتب والأجور (كسب العمل)</h2>
          <Link href="/payroll" className="text-xs text-teal-600 hover:underline">
            الانتقال إلى وحدة الرواتب العامة ←
          </Link>
        </div>
        {payrollAccount ? (
          <div className="panel stack p-4 border border-slate-200 dark:border-slate-800 rounded-xl">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-2">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-xs text-slate-500">ضريبة مستحقة (السنة الحالية)</div>
                <div className="text-base font-bold mt-1 text-slate-900 dark:text-slate-100">
                  {new Intl.NumberFormat(locale).format(payrollAccount.summary.taxDueCurrentYear)} ج.م
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-xs text-slate-500">مدفوعات مسددة</div>
                <div className="text-base font-bold mt-1 text-slate-900 dark:text-slate-100">
                  {new Intl.NumberFormat(locale).format(payrollAccount.summary.paymentsCurrentYear)} ج.م
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-xs text-slate-500">عدد الموظفين</div>
                <div className="text-base font-bold mt-1 text-slate-900 dark:text-slate-100">
                  {new Intl.NumberFormat(locale).format(payrollAccount.summary.employeeCount)}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-xs text-slate-500">إقرارات التقديم</div>
                <div className="text-base font-bold mt-1 text-slate-900 dark:text-slate-100">
                  <span className="text-emerald-600">{payrollAccount.summary.submittedFilings} مقدم</span>
                  <span className="text-slate-400 mx-1">·</span>
                  <span className={payrollAccount.summary.unsubmittedFilings > 0 ? 'text-amber-600' : 'text-slate-500'}>
                    {payrollAccount.summary.unsubmittedFilings} غير مقدم
                  </span>
                </div>
              </div>
            </div>

            {payrollAccount.obligations && payrollAccount.obligations.length > 0 ? (
              <div className="mt-3">
                <h4 className="text-sm font-semibold mb-2">التزامات التقديم ({payrollAccount.obligations.length}):</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th className="py-2 px-3">النموذج</th>
                        <th className="py-2 px-3">الفترة</th>
                        <th className="py-2 px-3">تاريخ الاستحقاق</th>
                        <th className="py-2 px-3">الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payrollAccount.obligations.map((ob, obIdx) => (
                        <tr key={ob.id || obIdx} className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-900/50">
                          <td className="py-2 px-3 font-medium">{ob.form || 'نموذج كسب عمل'}</td>
                          <td className="py-2 px-3">{ob.period || `${ob.periodFrom || ''} إلى ${ob.periodTo || ''}`}</td>
                          <td className="py-2 px-3 font-mono">{ob.dueDate || '—'}</td>
                          <td className="py-2 px-3">
                            {ob.submitted ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-2xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                                تم التقديم
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-2xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                                لم يتم التقديم
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 mt-2">لا توجد سجلات التزامات تقديم مفصلة لهذه الشركة.</p>
            )}
          </div>
        ) : (
          <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center">
            <p className="text-sm text-slate-500">
              لا توجد بيانات رواتب مسجلة لهذه الشركة بعد.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}

function companyInitialsOf(company) {
  return company.known ? identity.companyInitials(company.name) : ''
}
