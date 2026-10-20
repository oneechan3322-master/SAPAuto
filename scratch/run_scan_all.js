const { getDatabase } = require('../db/connect');
const { scanAndIngestAllPdfs } = require('../domain/pdf-scanner.cjs');

const db = getDatabase();

async function run() {
  console.log('Running scanAndIngestAllPdfs...');
  const result = await scanAndIngestAllPdfs({ db, importOlderVersions: true });
  console.log('Scan result:', result);

  const docCount = db.prepare('SELECT COUNT(*) as n FROM company_documents').get();
  const docWithFile = db.prepare("SELECT COUNT(*) as n FROM company_documents WHERE file_path <> ''").get();
  const docWithOcr = db.prepare("SELECT COUNT(*) as n FROM company_documents WHERE ocr_state = 'text_extracted'").get();
  const taskWithPdf = db.prepare("SELECT COUNT(*) as n FROM tasks WHERE pdf_path <> ''").get();

  console.log('Database Stats after Ingestion:');
  console.log(`- Total company_documents: ${docCount.n}`);
  console.log(`- company_documents with PDF files: ${docWithFile.n}`);
  console.log(`- Documents with extracted OCR text: ${docWithOcr.n}`);
  console.log(`- Tasks linked with PDF files: ${taskWithPdf.n}`);
}

run();
