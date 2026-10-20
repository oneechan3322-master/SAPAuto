const path = require('path');
const { extractPdfText } = require('../assistant/pdf-reader.cjs');

async function check(f) {
  const p = path.join(__dirname, '../data/pdfs', f);
  const pdf = await extractPdfText(p);
  console.log(`=== ${f} ===`);
  console.log(pdf.text.slice(0, 400));
}

async function run() {
  await check('180000221747- اخطار بعناصرربط الضريبة وقيمتها١٩.PDF');
  await check('180000207549.PDF');
  await check('755000003044.PDF');
}

run();
