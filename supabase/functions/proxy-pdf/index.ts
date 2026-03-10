const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Multiple strategies to get PDF content
async function tryFirecrawl(url: string, apiKey: string): Promise<{ success: boolean; markdown?: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50000);

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
        waitFor: 10000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: `Firecrawl ${response.status}: ${JSON.stringify(data.error || '')}` };
    }

    const markdown = data?.data?.markdown || data?.markdown || '';
    if (markdown.length > 100) {
      return { success: true, markdown };
    }
    return { success: false, error: 'No meaningful content from Firecrawl' };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Firecrawl error' };
  }
}

async function tryDirectFetchWithHeaders(url: string): Promise<{ success: boolean; markdown?: string; error?: string }> {
  try {
    // Try direct fetch with full browser impersonation
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/pdf,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
        'Referer': 'https://ceo.lacounty.gov/agendas/',
      },
      redirect: 'follow',
    });

    const contentType = resp.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
      const html = await resp.text();
      if (html.includes('Incapsula') || html.includes('_Incapsula') || html.includes('reese84')) {
        return { success: false, error: 'Incapsula challenge page' };
      }
      // Might be usable HTML content
      if (html.length > 500) {
        return { success: true, markdown: html };
      }
    }

    if (contentType.includes('pdf')) {
      // Got actual PDF - but we can't easily parse in Deno. Return raw length info.
      const buf = await resp.arrayBuffer();
      return { success: false, error: `Got PDF binary (${buf.byteLength} bytes) but cannot parse server-side` };
    }

    const text = await resp.text();
    return { success: false, error: `Unexpected response: ${contentType}, length: ${text.length}` };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Direct fetch error' };
  }
}

async function tryGoogleCacheSearch(url: string, firecrawlKey: string): Promise<{ success: boolean; markdown?: string; error?: string }> {
  try {
    // Use Firecrawl search to find cached versions of this document
    const filename = url.split('/').pop() || '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `LA County CEO agenda ${filename}`,
        limit: 3,
        scrapeOptions: { formats: ['markdown'] },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await response.json();

    if (data?.data?.length > 0) {
      const combined = data.data
        .filter((r: any) => r.markdown && r.markdown.length > 200)
        .map((r: any) => r.markdown)
        .join('\n\n---\n\n');

      if (combined.length > 200) {
        return { success: true, markdown: combined };
      }
    }

    return { success: false, error: 'No cached results found' };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Search error' };
  }
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

    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY') || '';
    const attempts: Array<{ technique: string; error?: string }> = [];

    // Strategy 1: Direct fetch (fastest, might work if Incapsula allows this IP)
    console.log(`[1/3] Direct fetch: ${url}`);
    const directResult = await tryDirectFetchWithHeaders(url);
    if (directResult.success) {
      console.log('Direct fetch succeeded!');
      return new Response(
        JSON.stringify({ success: true, markdown: directResult.markdown, technique: 'direct' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    attempts.push({ technique: 'direct', error: directResult.error });
    console.log(`Direct fetch failed: ${directResult.error}`);

    // Strategy 2: Firecrawl (has headless browser + anti-bot)
    if (firecrawlKey) {
      console.log(`[2/3] Firecrawl scrape: ${url}`);
      const fcResult = await tryFirecrawl(url, firecrawlKey);
      if (fcResult.success) {
        console.log('Firecrawl succeeded!');
        return new Response(
          JSON.stringify({ success: true, markdown: fcResult.markdown, technique: 'firecrawl' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      attempts.push({ technique: 'firecrawl', error: fcResult.error });
      console.log(`Firecrawl failed: ${fcResult.error}`);

      // Strategy 3: Search for cached versions
      console.log(`[3/3] Search for cached version`);
      const searchResult = await tryGoogleCacheSearch(url, firecrawlKey);
      if (searchResult.success) {
        console.log('Cached search succeeded!');
        return new Response(
          JSON.stringify({ success: true, markdown: searchResult.markdown, technique: 'search-cache' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      attempts.push({ technique: 'search-cache', error: searchResult.error });
      console.log(`Search cache failed: ${searchResult.error}`);
    }

    return new Response(
      JSON.stringify({ success: false, error: 'All techniques failed', attempts }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
