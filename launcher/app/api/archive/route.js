import { requireRole, requireSameOrigin } from '../../../lib/guard.js'
import { db } from '../../../lib/db.js'
import {
  listArchiveDocuments,
  listCompanyDocuments,
  getArchiveStats,
  saveCompanyDocument,
  deleteCompanyDocument,
  syncPortalDocuments
} from '../../../lib/data.js'
import documentsArchive from '../../../../domain/documents-archive.cjs'
import documentInspection from '../../../../domain/document-inspection.cjs'
import pdfScanner from '../../../../domain/pdf-scanner.cjs'

const { STANDARD_DOCUMENT_TYPES } = documentsArchive
const { analyzePendingCompanyDocuments } = documentInspection
const { scanAndIngestAllPdfs } = pdfScanner

export async function GET(request) {
  const authz = await requireRole(request, 'Viewer')
  if (authz.response) return authz.response

  const { searchParams } = new URL(request.url)
  const companyId = searchParams.get('companyId') || ''
  const docType = searchParams.get('docType') || ''
  const status = searchParams.get('status') || ''
  const query = searchParams.get('q') || ''

  try {
    const documents = listArchiveDocuments({ companyId, docType, status, query })
    const stats = getArchiveStats()
    return Response.json({
      ok: true,
      documents,
      stats,
      standardTypes: STANDARD_DOCUMENT_TYPES
    })
  } catch (err) {
    return Response.json({ error: `فشل استرجاع وثائق الأرشيف: ${err.message}` }, { status: 500 })
  }
}

export async function POST(request) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Operator')
  if (authz.response) return authz.response

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'بيانات غير صالحة' }, { status: 400 })
  }

  // Handle action=sync
  if (body?.action === 'sync') {
    try {
      const syncResult = syncPortalDocuments()
      const stats = getArchiveStats()
      return Response.json({ ok: true, syncResult, stats })
    } catch (err) {
      return Response.json({ error: `فشل مزامنة البوابة: ${err.message}` }, { status: 500 })
    }
  }

  if (body?.action === 'analyze_pdfs' || body?.action === 'scan_folder') {
    try {
      const scanResult = await scanAndIngestAllPdfs({ db, importOlderVersions: true })
      const analysisResult = await analyzePendingCompanyDocuments(db, 20)
      return Response.json({
        ok: true,
        result: { ...scanResult, analysis: analysisResult },
        documents: listArchiveDocuments(),
        stats: getArchiveStats()
      })
    } catch (err) {
      return Response.json({ error: `تعذر فحص وتحليل ملفات PDF: ${err.message}` }, { status: 500 })
    }
  }

  if (!body?.company_id || !body?.doc_type) {
    return Response.json({ error: 'معرّف الشركة ونوع الوثيقة مطلوبان.' }, { status: 400 })
  }

  try {
    const saved = saveCompanyDocument(body)
    return Response.json({ ok: true, document: saved })
  } catch (err) {
    return Response.json({ error: `فشل حفظ الوثيقة: ${err.message}` }, { status: 500 })
  }
}

export async function DELETE(request) {
  const originError = requireSameOrigin(request)
  if (originError) return originError
  const authz = await requireRole(request, 'Operator')
  if (authz.response) return authz.response

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) {
    return Response.json({ error: 'معرّف الوثيقة مطلوب لحذفها.' }, { status: 400 })
  }

  try {
    const ok = deleteCompanyDocument(id)
    if (!ok) {
      return Response.json({ error: 'لم يتم العثور على الوثيقة أو تعذر حذفها.' }, { status: 404 })
    }
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: `فشل حذف الوثيقة: ${err.message}` }, { status: 500 })
  }
}
