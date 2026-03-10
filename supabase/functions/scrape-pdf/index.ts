const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Browser-like headers to mimic Chrome on Windows
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/pdf',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

interface ScrapeResult {
  success: boolean;
  technique: string;
  markdown?: string;
  rawText?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// Technique 1: Firecrawl (has built-in headless browser + anti-bot)
async function tryFirecrawl(url: string): Promise<ScrapeResult> {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!apiKey) return { success: false, technique: 'firecrawl', error: 'No API key' };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: false,
        waitFor: 5000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await response.json();

    if (!response.ok) {
      return { success: false, technique: 'firecrawl', error: `Status ${response.status}: ${JSON.stringify(data.error || data)}` };
    }

    const markdown = data?.data?.markdown || data?.markdown;
    if (markdown && markdown.length > 100) {
      return { success: true, technique: 'firecrawl', markdown, metadata: data?.data?.metadata || data?.metadata };
    }

    return { success: false, technique: 'firecrawl', error: 'No meaningful content returned' };
  } catch (e) {
    return { success: false, technique: 'firecrawl', error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// Technique 2: Direct fetch with browser-like headers + referer chain
async function tryDirectFetch(url: string): Promise<ScrapeResult> {
  try {
    // Step 1: Visit the agendas listing page first to establish a "session"
    const refererUrl = 'https://ceo.lacounty.gov/agendas/';
    const sessionResp = await fetch(refererUrl, {
      headers: { ...BROWSER_HEADERS },
      redirect: 'follow',
    });
    
    // Capture any cookies from the session
    const setCookies = sessionResp.headers.get('set-cookie') || '';
    await sessionResp.text(); // consume body

    // Step 2: Fetch the actual PDF with the cookies and referer
    const pdfHeaders: Record<string, string> = {
      ...BROWSER_HEADERS,
      'Referer': refererUrl,
    };
    if (setCookies) {
      // Extract cookie name=value pairs
      const cookieParts = setCookies.split(',').map(c => c.split(';')[0].trim()).join('; ');
      pdfHeaders['Cookie'] = cookieParts;
    }

    const pdfResp = await fetch(url, {
      headers: pdfHeaders,
      redirect: 'follow',
    });

    if (!pdfResp.ok) {
      await pdfResp.text();
      return { success: false, technique: 'direct-fetch', error: `Status ${pdfResp.status}` };
    }

    const contentType = pdfResp.headers.get('content-type') || '';
    
    if (contentType.includes('pdf')) {
      // Got a PDF - convert to base64 for AI processing
      const buffer = await pdfResp.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      return {
        success: true,
        technique: 'direct-fetch',
        rawText: `[PDF_BASE64]:${base64}`,
        metadata: { contentType, size: bytes.length },
      };
    }

    // Might be HTML (Incapsula challenge page)
    const text = await pdfResp.text();
    if (text.includes('Incapsula') || text.includes('_Incapsula') || text.includes('reese84')) {
      return { success: false, technique: 'direct-fetch', error: 'Incapsula challenge page returned' };
    }

    // Might be readable text content
    if (text.length > 200) {
      return { success: true, technique: 'direct-fetch', rawText: text };
    }

    return { success: false, technique: 'direct-fetch', error: 'Response too short or not PDF' };
  } catch (e) {
    return { success: false, technique: 'direct-fetch', error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// Technique 3: Google Cache
async function tryGoogleCache(url: string): Promise<ScrapeResult> {
  try {
    const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
    const resp = await fetch(cacheUrl, {
      headers: { ...BROWSER_HEADERS },
      redirect: 'follow',
    });

    const text = await resp.text();
    if (!resp.ok || text.length < 200) {
      return { success: false, technique: 'google-cache', error: `Status ${resp.status}` };
    }

    // Google cache won't have PDFs usually, but worth trying
    return { success: true, technique: 'google-cache', rawText: text };
  } catch (e) {
    return { success: false, technique: 'google-cache', error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// Technique 4: Wayback Machine / Internet Archive
async function tryWaybackMachine(url: string): Promise<ScrapeResult> {
  try {
    // First check if Wayback has it
    const availResp = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] },
    });
    const availData = await availResp.json();

    const snapshot = availData?.archived_snapshots?.closest;
    if (!snapshot?.available || !snapshot?.url) {
      return { success: false, technique: 'wayback', error: 'No archived snapshot found' };
    }

    // Fetch the archived version
    const archiveResp = await fetch(snapshot.url, {
      headers: { ...BROWSER_HEADERS },
      redirect: 'follow',
    });

    const contentType = archiveResp.headers.get('content-type') || '';
    
    if (contentType.includes('pdf')) {
      const buffer = await archiveResp.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      return {
        success: true,
        technique: 'wayback',
        rawText: `[PDF_BASE64]:${base64}`,
        metadata: { archiveUrl: snapshot.url, timestamp: snapshot.timestamp },
      };
    }

    const text = await archiveResp.text();
    if (text.length > 200) {
      return { success: true, technique: 'wayback', rawText: text };
    }

    return { success: false, technique: 'wayback', error: 'Archived content too short' };
  } catch (e) {
    return { success: false, technique: 'wayback', error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// Technique 5: Firecrawl with alternate strategies (screenshot + rawHtml)
async function tryFirecrawlAlternate(url: string): Promise<ScrapeResult> {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!apiKey) return { success: false, technique: 'firecrawl-alt', error: 'No API key' };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'rawHtml'],
        onlyMainContent: false,
        waitFor: 10000, // longer wait for JS challenges
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await response.json();

    if (!response.ok) {
      return { success: false, technique: 'firecrawl-alt', error: `Status ${response.status}` };
    }

    const markdown = data?.data?.markdown || data?.markdown;
    const html = data?.data?.rawHtml || data?.rawHtml;
    
    if (markdown && markdown.length > 100) {
      return { success: true, technique: 'firecrawl-alt', markdown };
    }
    if (html && html.length > 500) {
      return { success: true, technique: 'firecrawl-alt', rawText: html };
    }

    return { success: false, technique: 'firecrawl-alt', error: 'No meaningful content' };
  } catch (e) {
    return { success: false, technique: 'firecrawl-alt', error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// Technique 6: Direct fetch without referer (sometimes simpler works)
async function trySimpleFetch(url: string): Promise<ScrapeResult> {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_HEADERS['User-Agent'],
        'Accept': '*/*',
      },
      redirect: 'follow',
    });

    if (!resp.ok) {
      await resp.text();
      return { success: false, technique: 'simple-fetch', error: `Status ${resp.status}` };
    }

    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('pdf')) {
      const buffer = await resp.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      return {
        success: true,
        technique: 'simple-fetch',
        rawText: `[PDF_BASE64]:${base64}`,
        metadata: { contentType, size: bytes.length },
      };
    }

    const text = await resp.text();
    if (text.includes('Incapsula') || text.includes('_Incapsula')) {
      return { success: false, technique: 'simple-fetch', error: 'Incapsula blocked' };
    }
    if (text.length > 200) {
      return { success: true, technique: 'simple-fetch', rawText: text };
    }

    return { success: false, technique: 'simple-fetch', error: 'Content too short' };
  } catch (e) {
    return { success: false, technique: 'simple-fetch', error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// Main handler: try all techniques in sequence
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, techniques } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Default technique order - can be overridden
    const techniqueOrder: string[] = techniques || [
      'firecrawl',
      'direct-fetch',
      'simple-fetch',
      'firecrawl-alt',
      'wayback',
      'google-cache',
    ];

    const techniqueMap: Record<string, (url: string) => Promise<ScrapeResult>> = {
      'firecrawl': tryFirecrawl,
      'direct-fetch': tryDirectFetch,
      'simple-fetch': trySimpleFetch,
      'firecrawl-alt': tryFirecrawlAlternate,
      'wayback': tryWaybackMachine,
      'google-cache': tryGoogleCache,
    };

    const attempts: ScrapeResult[] = [];

    for (const technique of techniqueOrder) {
      const fn = techniqueMap[technique];
      if (!fn) continue;

      console.log(`Trying technique: ${technique} for ${url}`);
      const result = await fn(url);
      attempts.push(result);

      if (result.success) {
        console.log(`SUCCESS with technique: ${technique}`);
        return new Response(
          JSON.stringify({ success: true, result, attempts }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`FAILED technique ${technique}: ${result.error}`);
    }

    // All techniques failed
    return new Response(
      JSON.stringify({ success: false, error: 'All scraping techniques failed', attempts }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Scrape error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
