import ArchiveView from '../../../components/archive-view.jsx'
import { listArchiveDocuments, getArchiveStats, listRecords } from '../../../lib/data.js'

export const metadata = {
  title: 'أرشيف الوثائق والسجلات القانونية — SAPAuto V8',
  description: 'أرشيف ومتابعة سريان البطاقات الضريبية والسجلات التجارية وشهادات القيمة المضافة والتوقيع الإلكتروني'
}

export default async function ArchivePage() {
  const documents = listArchiveDocuments()
  const stats = getArchiveStats()
  const companies = listRecords('companies')

  return (
    <div className="archive-page stack">
      <ArchiveView
        initialDocuments={documents}
        companies={companies}
        stats={stats}
      />
    </div>
  )
}
