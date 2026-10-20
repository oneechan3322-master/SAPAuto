import Link from 'next/link'
import { Users, FileText, AlertCircle, ArrowLeft, ShieldCheck, CheckCircle2, Building2, Calendar, DollarSign, Clock } from 'lucide-react'
import { readPayrollData } from '../../../lib/data.js'
import { formatNumber, formatDateTime, numberLocale } from '../../../lib/display.js'

export const metadata = {
  title: 'وحدة الرواتب والأجور — SAPAuto V8',
  description: 'متابعة وإدارة كشوف التزامات المرتبات والأجور عبر بوابة الضرائب المصرية ZMCF_PAYROLL'
}

export default async function PayrollPage() {
  const payroll = readPayrollData()
  const locale = await numberLocale()

  const totalCompanies = payroll.accounts.length
  let totalObligations = 0
  let totalSubmitted = 0
  let totalUnsubmitted = 0
  let totalTaxDue = 0
  let totalEmployees = 0

  for (const acct of payroll.accounts) {
    totalObligations += acct.obligations.length
    totalSubmitted += acct.summary.submittedFilings || 0
    totalUnsubmitted += acct.summary.unsubmittedFilings || 0
    totalTaxDue += acct.summary.taxDueCurrentYear || 0
    totalEmployees += acct.summary.employeeCount || 0
  }

  const hasData = payroll.available && totalCompanies > 0

  return (
    <div className="payroll-page stack">
      <div className="page-heading between">
        <div>
          <div className="eyebrow">منظومة الضرائب المصرية · ZMCF_PAYROLL</div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="text-teal-600 inline" size={28} />
            وحدة الرواتب والأجور
          </h1>
          <p className="muted">
            رصد وقراءة التزامات كسب العمل والمرتبات، كشوف التسوية السنوية، والإقرارات الربع سنوية وفق بوابة مصلحة الضرائب.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`state-pill ${hasData ? 'state-good' : 'state-neutral'}`}>
            <i /> {hasData ? 'قارئ الرواتب: قراءة فقط' : 'قارئ الرواتب: في انتظار الفحص'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Link href="/companies" className="health-card hover:border-teal-500 transition-colors block">
          <div className="health-icon icon-teal">👥</div>
          <div className="health-label">الشركات المسجلة بالرواتب</div>
          <strong>{new Intl.NumberFormat(locale).format(totalCompanies)}</strong>
          <span className="muted">فتح قائمة الشركات</span>
        </Link>
        <div className="health-card">
          <div className="health-icon icon-blue">📋</div>
          <div className="health-label">التزامات التقديم (كسب العمل)</div>
          <strong>{new Intl.NumberFormat(locale).format(totalObligations)}</strong>
          <span className="muted">إجمالي الالتزامات المرصودة</span>
        </div>
        <div className="health-card">
          <div className="health-icon icon-amber">⏳</div>
          <div className="health-label">إقرارات غير مقدمة</div>
          <strong>{new Intl.NumberFormat(locale).format(totalUnsubmitted)}</strong>
          <span className="muted">{new Intl.NumberFormat(locale).format(totalSubmitted)} إقرار تم تقديمه</span>
        </div>
        <div className="health-card">
          <div className="health-icon icon-teal">🛡️</div>
          <div className="health-label">حالة القارئ المحلي</div>
          <strong>{hasData ? 'بيانات متزامنة' : 'لم يُفحص بعد'}</strong>
          <span className="muted">
            {payroll.scannedAt
              ? `آخر قراءة: ${payroll.scannedAt.slice(0, 10)}`
              : 'لا يتم أي تقديم أو دفع تلقائي'}
          </span>
        </div>
      </div>

      {!hasData ? (
        <section className="panel stack mt-6">
          <div className="section-heading">
            <span className="section-index">01</span>
            <div>
              <h2>كشوف التزامات الرواتب والأجور (Filing Obligations)</h2>
              <p className="muted">
                عرض تحليلي لنماذج كسب العمل المحفوظة والمستخرجة من وحدة SAP UI5 ZMCF_PAYROLL.
              </p>
            </div>
          </div>

          <div className="p-8 text-center bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
            <CheckCircle2 className="mx-auto text-teal-500 mb-3" size={36} />
            <h3 className="font-semibold text-lg text-slate-800 dark:text-slate-100">
              لم يتم تشغيل فحص الرواتب بعد
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl mx-auto mt-2 leading-relaxed">
              لم يتم العثور على ملف بيانات الرواتب المحلي (<code className="px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-800">data/payroll.json</code>).
              قارئ الرواتب جاهز للتشغيل للقراءة فقط عبر وحدة <code className="px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-800">ZMCF_PAYROLL</code> دون إجراء أي تغييرات أو مدفوعات.
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              <Link href="/settings" className="button-secondary inline-flex items-center gap-2">
                <ArrowLeft size={16} />
                الانتقال إلى الإعدادات ومراجعة حالة الفحص
              </Link>
              <Link href="/companies" className="button-ghost inline-flex items-center gap-2">
                <Building2 size={16} />
                عرض قائمة الشركات
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <section className="stack mt-6">
          <div className="section-heading">
            <span className="section-index">01</span>
            <div>
              <h2>كشوف حسابات الرواتب والأجور</h2>
              <p className="muted">
                بيانات مستخرجة ومطابقة من بوابة الضرائب المصرية ZMCF_PAYROLL.
              </p>
            </div>
          </div>

          <div className="stack gap-6">
            {payroll.accounts.map((acct, idx) => {
              const companyLink = acct.companyId ? `/companies/${encodeURIComponent(acct.companyId)}` : '/companies'
              return (
                <div key={acct.accountKey || acct.company || idx} className="panel stack p-5 border border-slate-200 dark:border-slate-800 rounded-xl">
                  <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-teal-50 dark:bg-teal-950/40 text-teal-600 flex items-center justify-center font-bold">
                        <Building2 size={20} />
                      </div>
                      <div>
                        <Link href={companyLink} className="text-lg font-bold hover:text-teal-600 transition-colors flex items-center gap-2">
                          {acct.company || acct.accountKey || 'شركة غير محددة'}
                          <span className="text-xs font-normal text-teal-600 underline">عرض سجل الشركة ←</span>
                        </Link>
                        {acct.accountKey && (
                          <span className="text-xs text-slate-500 font-mono">رقم الحساب: {acct.accountKey}</span>
                        )}
                      </div>
                    </div>
                    {acct.scannedAt && (
                      <span className="text-xs text-slate-500">
                        تاريخ الفحص: {acct.scannedAt.slice(0, 10)}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-3">
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <div className="text-xs text-slate-500">إجمالي الضريبة المستحقة (السنة الحالية)</div>
                      <div className="text-base font-bold mt-1 text-slate-900 dark:text-slate-100">
                        {new Intl.NumberFormat(locale).format(acct.summary.taxDueCurrentYear)} ج.م
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <div className="text-xs text-slate-500">مدفوعات ضريبة المرتبات</div>
                      <div className="text-base font-bold mt-1 text-slate-900 dark:text-slate-100">
                        {new Intl.NumberFormat(locale).format(acct.summary.paymentsCurrentYear)} ج.م
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <div className="text-xs text-slate-500">عدد الموظفين الحاليين</div>
                      <div className="text-base font-bold mt-1 text-slate-900 dark:text-slate-100">
                        {new Intl.NumberFormat(locale).format(acct.summary.employeeCount)}
                        <span className="text-xs font-normal text-slate-500 mr-1">
                          ({acct.summary.egyptianEmployees} مصري · {acct.summary.foreignEmployees} أجنبي)
                        </span>
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <div className="text-xs text-slate-500">إقرارات التقديم</div>
                      <div className="text-base font-bold mt-1 text-slate-900 dark:text-slate-100">
                        <span className="text-emerald-600">{acct.summary.submittedFilings} مقدم</span>
                        <span className="text-slate-400 mx-1">·</span>
                        <span className={acct.summary.unsubmittedFilings > 0 ? 'text-amber-600' : 'text-slate-500'}>
                          {acct.summary.unsubmittedFilings} غير مقدم
                        </span>
                      </div>
                    </div>
                  </div>

                  {acct.obligations && acct.obligations.length > 0 ? (
                    <div className="mt-3">
                      <h4 className="text-sm font-semibold mb-2">التزامات التقديم ({acct.obligations.length}):</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-right text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                              <th className="py-2 px-3">النموذج</th>
                              <th className="py-2 px-3">نوع الإيراد</th>
                              <th className="py-2 px-3">الفترة</th>
                              <th className="py-2 px-3">تاريخ الاستحقاق</th>
                              <th className="py-2 px-3">الحالة</th>
                            </tr>
                          </thead>
                          <tbody>
                            {acct.obligations.map((ob, obIdx) => (
                              <tr key={ob.id || obIdx} className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-900/50">
                                <td className="py-2 px-3 font-medium">{ob.form || 'نموذج كسب عمل'}</td>
                                <td className="py-2 px-3 text-slate-500">{ob.revenueType || '—'}</td>
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
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
