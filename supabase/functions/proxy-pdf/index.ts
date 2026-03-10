const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ── Helpers ──────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(minMs: number, maxMs: number) {
  return sleep(minMs + Math.random() * (maxMs - minMs));
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

interface ScrapeResult {
  success: boolean;
  text?: string;
  technique?: string;
  error?: string;
}

// ── PDF text extraction (zero-dependency, works in Deno) ─────────────

async function extractTextFromPdfBytes(bytes: Uint8Array): Promise<string> {
  const textParts: string[] = [];
  const raw = new TextDecoder('latin1').decode(bytes);

  // Find all PDF objects and process their streams
  const objRegex = /(\d+ \d+ obj[\s\S]*?endobj)/g;
  let objMatch;

  while ((objMatch = objRegex.exec(raw)) !== null) {
    const obj = objMatch[1];

    // Locate stream boundaries
    let hdrLen: number;
    let sIdx = obj.indexOf('stream\r\n');
    if (sIdx !== -1) { hdrLen = 8; }
    else { sIdx = obj.indexOf('stream\n'); hdrLen = 7; }
    if (sIdx === -1) continue;

    const eIdx = obj.lastIndexOf('endstream');
    if (eIdx === -1 || eIdx <= sIdx) continue;

    const streamBytes = bytes.slice(
      objMatch.index + sIdx + hdrLen,
      objMatch.index + eIdx
    );

    let content: string;

    if (obj.includes('/FlateDecode')) {
      try {
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        writer.write(streamBytes).catch(() => {});
        writer.close().catch(() => {});
        const reader = ds.readable.getReader();
        const chunks: Uint8Array[] = [];
        try { while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); } } catch { /* partial OK */ }
        const total = chunks.reduce((a, c) => a + c.length, 0);
        const dec = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { dec.set(c, off); off += c.length; }
        content = new TextDecoder('latin1').decode(dec);
      } catch { continue; }
    } else {
      content = new TextDecoder('latin1').decode(streamBytes);
    }

    // Extract text operators
    const btEt = /BT\s([\s\S]*?)ET/g;
    let bm;
    while ((bm = btEt.exec(content)) !== null) {
      const block = bm[1];
      // Tj
      const tj = /\(([^)]*)\)\s*Tj/g;
      let tm;
      while ((tm = tj.exec(block)) !== null) textParts.push(tm[1]);
      // TJ arrays
      const tja = /\[((?:[^[\]]*|\[[^\]]*\])*)\]\s*TJ/g;
      let tam;
      while ((tam = tja.exec(block)) !== null) {
        const sr = /\(([^)]*)\)/g;
        let sm;
        while ((sm = sr.exec(tam[1])) !== null) textParts.push(sm[1]);
      }
    }
  }

  return textParts
    .map(t => t.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
      .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Technique 1: Direct fetch with browser impersonation + retries ───

async function tryDirectFetch(url: string): Promise<ScrapeResult> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      // Generous throttle: 3-8 seconds between retries
      await randomDelay(3000, 8000);
    }

    const ua = USER_AGENTS[attempt % USER_AGENTS.length];

    try {
      // First visit the listing page to get cookies (session establishment)
      const sessionResp = await fetch('https://ceo.lacounty.gov/agendas/', {
        headers: { 'User-Agent': ua, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
        redirect: 'follow',
      });
      const sessionCookies = sessionResp.headers.get('set-cookie') || '';
      await sessionResp.text(); // consume

      await randomDelay(1000, 3000); // Human-like pause between page loads

      // Now fetch the PDF with cookies and referer
      const headers: Record<string, string> = {
        'User-Agent': ua,
        'Accept': 'application/pdf,application/octet-stream,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://ceo.lacounty.gov/agendas/',
        'Sec-Ch-Ua': '"Chromium";v="125", "Google Chrome";v="125", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Upgrade-Insecure-Requests': '1',
      };
      if (sessionCookies) {
        const cookies = sessionCookies.split(',').map(c => c.split(';')[0].trim()).join('; ');
        headers['Cookie'] = cookies;
      }

      const resp = await fetch(url, { headers, redirect: 'follow' });

      if (!resp.ok) {
        await resp.text();
        console.log(`  Direct attempt ${attempt + 1}: HTTP ${resp.status}`);
        continue;
      }

      const ct = resp.headers.get('content-type') || '';

      if (ct.includes('text/html')) {
        const html = await resp.text();
        if (html.includes('Incapsula') || html.includes('_Incapsula') || html.includes('reese84')) {
          console.log(`  Direct attempt ${attempt + 1}: Incapsula challenge`);
          continue;
        }
      }

      // Got something — check if it's a PDF
      const buf = await resp.arrayBuffer();
      const header = String.fromCharCode(...new Uint8Array(buf.slice(0, 5)));
      if (!header.startsWith('%PDF')) {
        console.log(`  Direct attempt ${attempt + 1}: Not a PDF (${header.substring(0, 10)})`);
        continue;
      }

      console.log(`  Direct attempt ${attempt + 1}: Got PDF (${buf.byteLength} bytes)`);

      // Parse text from PDF
      const text = await extractTextFromPdfBytes(new Uint8Array(buf));
      if (text.length > 50) {
        return { success: true, text, technique: 'direct-fetch' };
      }

      console.log(`  Direct: PDF parsed but only ${text.length} chars (may be image-based)`);
      // Don't return failure yet — Firecrawl handles image PDFs better
      return { success: false, error: `PDF parsed but only ${text.length} chars extracted (possibly scanned)` };
    } catch (e) {
      console.log(`  Direct attempt ${attempt + 1}: ${e instanceof Error ? e.message : 'error'}`);
    }
  }

  return { success: false, error: 'Direct fetch: all attempts blocked by Incapsula' };
}

// ── Technique 2: Firecrawl (headless browser + anti-bot + proxy rotation) ──

async function tryFirecrawl(url: string): Promise<ScrapeResult> {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!apiKey) return { success: false, error: 'Firecrawl not configured' };

  try {
    console.log('  Firecrawl: scraping...');
    const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: false,
        timeout: 55000,
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      const errMsg = typeof data.error === 'string' ? data.error.substring(0, 200) : JSON.stringify(data.error || '').substring(0, 200);
      console.log(`  Firecrawl: HTTP ${resp.status} — ${errMsg}`);
      return { success: false, error: `Firecrawl ${resp.status}: ${errMsg}` };
    }

    const markdown = data?.data?.markdown || data?.markdown || '';
    console.log(`  Firecrawl: got ${markdown.length} chars`);

    if (markdown.length > 50) {
      return { success: true, text: markdown, technique: 'firecrawl' };
    }

    return { success: false, error: 'Firecrawl returned insufficient content' };
  } catch (e) {
    return { success: false, error: `Firecrawl: ${e instanceof Error ? e.message : 'error'}` };
  }
}

// ── Technique 3: Firecrawl with rawHtml format (different parsing path) ──

async function tryFirecrawlRawHtml(url: string): Promise<ScrapeResult> {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!apiKey) return { success: false, error: 'Firecrawl not configured' };

  try {
    console.log('  Firecrawl (rawHtml): scraping...');
    const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'rawHtml'],
        onlyMainContent: false,
        waitFor: 15000,
        timeout: 55000,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return { success: false, error: `Firecrawl rawHtml ${resp.status}` };
    }

    const markdown = data?.data?.markdown || data?.markdown || '';
    const html = data?.data?.rawHtml || data?.rawHtml || '';

    if (markdown.length > 50) {
      return { success: true, text: markdown, technique: 'firecrawl-rawhtml' };
    }
    if (html.length > 200) {
      // Strip HTML tags for plain text
      const plain = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (plain.length > 50) {
        return { success: true, text: plain, technique: 'firecrawl-rawhtml' };
      }
    }

    return { success: false, error: 'Firecrawl rawHtml: no content' };
  } catch (e) {
    return { success: false, error: `Firecrawl rawHtml: ${e instanceof Error ? e.message : 'error'}` };
  }
}

// ── Technique 4: Firecrawl search for cached/indexed versions ──

async function tryFirecrawlSearch(url: string): Promise<ScrapeResult> {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!apiKey) return { success: false, error: 'Firecrawl not configured' };

  try {
    const filename = url.split('/').pop() || '';
    console.log(`  Firecrawl search: "${filename}"...`);

    const resp = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `LA County CEO cluster agenda "${filename}"`,
        limit: 5,
        scrapeOptions: { formats: ['markdown'] },
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return { success: false, error: `Firecrawl search: ${resp.status}` };
    }

    const results = data?.data || [];
    const combined = results
      .filter((r: any) => r.markdown && r.markdown.length > 100)
      .map((r: any) => r.markdown)
      .join('\n\n---\n\n');

    if (combined.length > 100) {
      return { success: true, text: combined, technique: 'firecrawl-search' };
    }

    return { success: false, error: 'No cached results found' };
  } catch (e) {
    return { success: false, error: `Firecrawl search: ${e instanceof Error ? e.message : 'error'}` };
  }
}

// ── Technique 5: Wayback Machine (Internet Archive) ──

async function tryWayback(url: string): Promise<ScrapeResult> {
  try {
    console.log('  Wayback: checking...');
    const availResp = await fetch(
      `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
      { headers: { 'User-Agent': USER_AGENTS[0] } }
    );
    const availData = await availResp.json();
    const snapshot = availData?.archived_snapshots?.closest;

    if (!snapshot?.available || !snapshot?.url) {
      return { success: false, error: 'No Wayback Machine snapshot' };
    }

    console.log(`  Wayback: found snapshot from ${snapshot.timestamp}`);
    await randomDelay(1000, 2000);

    const archiveResp = await fetch(snapshot.url, {
      headers: { 'User-Agent': USER_AGENTS[0] },
      redirect: 'follow',
    });

    const ct = archiveResp.headers.get('content-type') || '';

    if (ct.includes('pdf')) {
      const buf = await archiveResp.arrayBuffer();
      const text = await extractTextFromPdfBytes(new Uint8Array(buf));
      if (text.length > 50) {
        return { success: true, text, technique: 'wayback' };
      }
      return { success: false, error: 'Wayback PDF has no extractable text' };
    }

    const text = await archiveResp.text();
    if (text.length > 200 && !text.includes('Incapsula')) {
      return { success: true, text, technique: 'wayback' };
    }

    return { success: false, error: 'Wayback: unusable content' };
  } catch (e) {
    return { success: false, error: `Wayback: ${e instanceof Error ? e.message : 'error'}` };
  }
}

// ── Technique 6: Google Cache via Firecrawl ──

async function tryGoogleCache(url: string): Promise<ScrapeResult> {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!apiKey) return { success: false, error: 'Firecrawl not configured' };

  try {
    const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
    console.log('  Google Cache via Firecrawl...');

    const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: cacheUrl,
        formats: ['markdown'],
        timeout: 30000,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return { success: false, error: `Google Cache: ${resp.status}` };
    }

    const markdown = data?.data?.markdown || data?.markdown || '';
    if (markdown.length > 100) {
      return { success: true, text: markdown, technique: 'google-cache' };
    }

    return { success: false, error: 'Google Cache: no content' };
  } catch (e) {
    return { success: false, error: `Google Cache: ${e instanceof Error ? e.message : 'error'}` };
  }
}

// ── Main handler ─────────────────────────────────────────────────────

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

    console.log(`\n=== Scraping: ${url} ===`);

    // Chain all techniques with throttle between each
    const techniques: Array<{ name: string; fn: () => Promise<ScrapeResult> }> = [
      { name: 'Firecrawl', fn: () => tryFirecrawl(url) },
      { name: 'Direct fetch', fn: () => tryDirectFetch(url) },
      { name: 'Firecrawl rawHtml', fn: () => tryFirecrawlRawHtml(url) },
      { name: 'Wayback Machine', fn: () => tryWayback(url) },
      { name: 'Firecrawl search', fn: () => tryFirecrawlSearch(url) },
      { name: 'Google Cache', fn: () => tryGoogleCache(url) },
    ];

    const attempts: Array<{ technique: string; error?: string }> = [];

    for (let i = 0; i < techniques.length; i++) {
      const { name, fn } = techniques[i];
      console.log(`[${i + 1}/${techniques.length}] Trying: ${name}`);

      const result = await fn();

      if (result.success && result.text) {
        console.log(`✓ SUCCESS via ${result.technique} (${result.text.length} chars)`);
        return new Response(
          JSON.stringify({ success: true, text: result.text, technique: result.technique }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`✗ ${name} failed: ${result.error}`);
      attempts.push({ technique: name, error: result.error });

      // Generous throttle between techniques (3-6 seconds)
      if (i < techniques.length - 1) {
        await randomDelay(3000, 6000);
      }
    }

    return new Response(
      JSON.stringify({ success: false, error: 'All scraping techniques exhausted', attempts }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Fatal error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
