// services/docxFromHtml.js
const htmlToDocx = require('html-to-docx');

async function buildDocxFromHtml(html) {
  // Márgenes en Twips (~1/20 de punto). 720 ≈ 12mm
  const docxBuffer = await htmlToDocx(html, null, {
    table: { row: { cantSplit: true } },
    margins: { top: 720, right: 680, bottom: 800, left: 680 },
    footer: false,
    pageNumber: false,
  });
  return docxBuffer;
}

module.exports = { buildDocxFromHtml };
