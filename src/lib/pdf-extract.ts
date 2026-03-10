import * as pdfjsLib from 'pdfjs-dist';

// Use the CDN worker to avoid bundling issues
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`;

/**
 * Fetches a PDF from a URL (using the browser's network stack to bypass Incapsula)
 * and extracts all text content.
 */
export async function extractTextFromPdfUrl(url: string): Promise<string> {
  // Fetch PDF as arraybuffer from the browser
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  
  // Check if we got HTML (Incapsula challenge) instead of PDF
  if (contentType.includes('text/html')) {
    const text = await response.text();
    if (text.includes('Incapsula') || text.includes('_Incapsula')) {
      throw new Error('Incapsula bot protection blocked the request. Please try again or open the PDF in a new tab first.');
    }
    throw new Error('Received HTML instead of PDF');
  }

  const arrayBuffer = await response.arrayBuffer();
  
  // Verify it's actually a PDF by checking magic bytes
  const header = new Uint8Array(arrayBuffer.slice(0, 5));
  const headerStr = String.fromCharCode(...header);
  if (!headerStr.startsWith('%PDF')) {
    throw new Error('Downloaded file is not a valid PDF');
  }

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
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
