const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPdfWithRetry(url: string, maxRetries = 3): Promise<{ success: boolean; bytes?: Uint8Array; error?: string }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = 1000 + Math.random() * 2000; // 1-3s random delay
      console.log(`Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms...`);
      await sleep(delay);
    }

    const ua = USER_AGENTS[attempt % USER_AGENTS.length];

    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': ua,
          'Accept': 'application/pdf,application/octet-stream,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://ceo.lacounty.gov/agendas/',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
        },
        redirect: 'follow',
      });

      if (!resp.ok) {
        await resp.text();
        console.log(`Attempt ${attempt + 1}: HTTP ${resp.status}`);
        continue;
      }

      const contentType = resp.headers.get('content-type') || '';

      if (contentType.includes('text/html')) {
        const html = await resp.text();
        if (html.includes('Incapsula') || html.includes('_Incapsula') || html.includes('reese84')) {
          console.log(`Attempt ${attempt + 1}: Incapsula challenge`);
          continue;
        }
      }

      // Got the PDF
      const buffer = await resp.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      
      // Verify it's a PDF
      const header = String.fromCharCode(...bytes.slice(0, 5));
      if (header.startsWith('%PDF')) {
        console.log(`Attempt ${attempt + 1}: Got PDF (${bytes.length} bytes)`);
        return { success: true, bytes };
      }

      console.log(`Attempt ${attempt + 1}: Not a PDF (header: ${header})`);
    } catch (e) {
      console.log(`Attempt ${attempt + 1}: ${e instanceof Error ? e.message : 'error'}`);
    }
  }

  return { success: false, error: `Failed after ${maxRetries} attempts (Incapsula bot protection)` };
}

// Extract text from PDF using DecompressionStream API (zero dependencies)
async function extractTextFromPdf(bytes: Uint8Array): Promise<string> {
  const raw = new TextDecoder('latin1').decode(bytes);
  const textParts: string[] = [];

  // Find all objects in the PDF
  const objRegex = /(\d+ \d+ obj[\s\S]*?endobj)/g;
  let objMatch;

  while ((objMatch = objRegex.exec(raw)) !== null) {
    const obj = objMatch[1];

    // Find stream content
    let streamStartIdx = obj.indexOf('stream\r\n');
    let headerLen = 'stream\r\n'.length;
    if (streamStartIdx === -1) {
      streamStartIdx = obj.indexOf('stream\n');
      headerLen = 'stream\n'.length;
    }
    if (streamStartIdx === -1) continue;

    const streamEndIdx = obj.lastIndexOf('endstream');
    if (streamEndIdx === -1 || streamEndIdx <= streamStartIdx) continue;

    const streamStart = objMatch.index + streamStartIdx + headerLen;
    const streamEnd = objMatch.index + streamEndIdx;
    const streamBytes = bytes.slice(streamStart, streamEnd);

    let content: string;

    if (obj.includes('/FlateDecode')) {
      // Decompress the stream
      try {
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        writer.write(streamBytes).catch(() => {});
        writer.close().catch(() => {});

        const reader = ds.readable.getReader();
        const chunks: Uint8Array[] = [];
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
        } catch {
          // partial read is OK
        }

        const total = chunks.reduce((a, c) => a + c.length, 0);
        const decompressed = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          decompressed.set(chunk, offset);
          offset += chunk.length;
        }

        content = new TextDecoder('latin1').decode(decompressed);
      } catch {
        continue;
      }
    } else {
      content = new TextDecoder('latin1').decode(streamBytes);
    }

    // Extract text operators from the content
    const btEtRegex = /BT\s([\s\S]*?)ET/g;
    let btMatch;
    while ((btMatch = btEtRegex.exec(content)) !== null) {
      const block = btMatch[1];

      // Tj operator: (text) Tj
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        textParts.push(tjMatch[1]);
      }

      // TJ operator: [(text) num (text)] TJ
      const tjArrayRegex = /\[((?:[^[\]]*|\[(?:[^[\]]*)\])*)\]\s*TJ/g;
      let tjArrMatch;
      while ((tjArrMatch = tjArrayRegex.exec(block)) !== null) {
        const strRegex = /\(([^)]*)\)/g;
        let strMatch;
        while ((strMatch = strRegex.exec(tjArrMatch[1])) !== null) {
          textParts.push(strMatch[1]);
        }
      }
    }
  }

  // Decode PDF escape sequences and clean up
  return textParts
    .map(t => t
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\')
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Fetching PDF:', url);

    // Fetch with retries (Incapsula is intermittent)
    const fetchResult = await fetchPdfWithRetry(url, 3);

    if (!fetchResult.success || !fetchResult.bytes) {
      return new Response(
        JSON.stringify({ success: false, error: fetchResult.error }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract text from PDF
    console.log('Extracting text from PDF...');
    const text = await extractTextFromPdf(fetchResult.bytes);
    console.log(`Extracted ${text.length} chars`);

    if (text.length < 50) {
      return new Response(
        JSON.stringify({ success: false, error: 'PDF has no extractable text (may be scanned/image-only PDF)' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, text, metadata: { size: fetchResult.bytes.length } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
