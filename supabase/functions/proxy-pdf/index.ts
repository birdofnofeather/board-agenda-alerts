const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Lightweight PDF text extraction without external dependencies
// Handles simple text-based PDFs by parsing the PDF stream objects
function extractTextFromPdfBytes(bytes: Uint8Array): string {
  const text = new TextDecoder('latin1').decode(bytes);
  const textParts: string[] = [];

  // Extract text from BT...ET blocks (PDF text objects)
  const btEtRegex = /BT\s([\s\S]*?)ET/g;
  let match;
  while ((match = btEtRegex.exec(text)) !== null) {
    const block = match[1];
    // Extract text from Tj, TJ, ', " operators
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      textParts.push(tjMatch[1]);
    }

    // TJ arrays: [(text) num (text) ...]
    const tjArrayRegex = /\[(.*?)\]\s*TJ/g;
    let tjArrMatch;
    while ((tjArrMatch = tjArrayRegex.exec(block)) !== null) {
      const arr = tjArrMatch[1];
      const strRegex = /\(([^)]*)\)/g;
      let strMatch;
      while ((strMatch = strRegex.exec(arr)) !== null) {
        textParts.push(strMatch[1]);
      }
    }
  }

  // Also try to find stream content with FlateDecode
  // Decompress deflated streams to find more text
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let streamMatch;
  while ((streamMatch = streamRegex.exec(text)) !== null) {
    try {
      const streamData = streamMatch[1];
      // Try to find readable text in the stream
      const readable = streamData.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
      if (readable.length > 20 && readable.match(/[a-zA-Z]{3,}/)) {
        // Has meaningful English words
        textParts.push(readable);
      }
    } catch {
      // Skip unreadable streams
    }
  }

  // Decode PDF escape sequences
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

// Decompress deflated PDF streams using DecompressionStream API
async function decompressStreams(bytes: Uint8Array): Promise<string> {
  const text = new TextDecoder('latin1').decode(bytes);
  const textParts: string[] = [];

  // Find all FlateDecode streams
  const objRegex = /(\d+ \d+ obj[\s\S]*?endobj)/g;
  let objMatch;

  while ((objMatch = objRegex.exec(text)) !== null) {
    const obj = objMatch[1];
    if (!obj.includes('/FlateDecode')) continue;

    const streamStart = obj.indexOf('stream\r\n');
    const streamStartAlt = obj.indexOf('stream\n');
    const actualStart = streamStart !== -1
      ? streamStart + 'stream\r\n'.length
      : streamStartAlt !== -1
        ? streamStartAlt + 'stream\n'.length
        : -1;

    if (actualStart === -1) continue;

    const streamEnd = obj.indexOf('\nendstream', actualStart);
    if (streamEnd === -1) continue;

    // Get raw bytes of the stream
    const streamBytes = bytes.slice(
      objMatch.index + actualStart,
      objMatch.index + streamEnd
    );

    try {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(streamBytes);
      writer.close();

      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const decompressed = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        decompressed.set(chunk, offset);
        offset += chunk.length;
      }

      const decompressedText = new TextDecoder('latin1').decode(decompressed);

      // Extract text from the decompressed content
      const btEtRegex = /BT\s([\s\S]*?)ET/g;
      let btMatch;
      while ((btMatch = btEtRegex.exec(decompressedText)) !== null) {
        const block = btMatch[1];
        const tjRegex = /\(([^)]*)\)\s*Tj/g;
        let tjMatch;
        while ((tjMatch = tjRegex.exec(block)) !== null) {
          textParts.push(tjMatch[1]);
        }
        const tjArrayRegex = /\[(.*?)\]\s*TJ/g;
        let tjArrMatch;
        while ((tjArrMatch = tjArrayRegex.exec(block)) !== null) {
          const strRegex = /\(([^)]*)\)/g;
          let strMatch;
          while ((strMatch = strRegex.exec(tjArrMatch[1])) !== null) {
            textParts.push(strMatch[1]);
          }
        }
      }
    } catch {
      // Decompression failed, skip this stream
    }
  }

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

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/pdf,*/*',
        'Referer': 'https://ceo.lacounty.gov/agendas/',
      },
      redirect: 'follow',
    });

    if (!resp.ok) {
      await resp.text();
      return new Response(
        JSON.stringify({ success: false, error: `Fetch failed: ${resp.status}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const contentType = resp.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
      const html = await resp.text();
      if (html.includes('Incapsula') || html.includes('_Incapsula')) {
        return new Response(
          JSON.stringify({ success: false, error: 'Blocked by Incapsula' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ success: false, error: 'Got HTML instead of PDF' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const buffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    console.log(`Got PDF: ${bytes.length} bytes`);

    // Try to extract text - first from uncompressed, then from compressed streams
    let text = extractTextFromPdfBytes(bytes);
    console.log(`Uncompressed extraction: ${text.length} chars`);

    if (text.length < 100) {
      console.log('Trying decompressed streams...');
      const decompressedText = await decompressStreams(bytes);
      if (decompressedText.length > text.length) {
        text = decompressedText;
      }
      console.log(`Decompressed extraction: ${text.length} chars`);
    }

    if (text.length < 50) {
      return new Response(
        JSON.stringify({ success: false, error: 'PDF has no extractable text (may be scanned/image-only)' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, text, metadata: { size: bytes.length } }),
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
