import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`;

/**
 * Extract text from a PDF ArrayBuffer using pdf.js
 */
export async function extractTextFromPdfBuffer(buffer: ArrayBuffer): Promise<string> {
  const header = new Uint8Array(buffer.slice(0, 5));
  const headerStr = String.fromCharCode(...header);
  if (!headerStr.startsWith('%PDF')) {
    throw new Error('File is not a valid PDF');
  }

  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    pages.push(`[Page ${i}]\n${pageText}`);
  }

  return pages.join('\n\n');
}
