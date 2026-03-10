const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function tryFirecrawl(url: string, apiKey: string): Promise<{ success: boolean; text?: string; cached?: boolean; error?: string; retryable?: boolean }> {
  console.log('Trying Firecrawl for:', url);
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
    const errMsg = typeof data.error === 'string'
      ? data.error.substring(0, 200)
      : JSON.stringify(data.error || '').substring(0, 200);
    console.log(`Firecrawl error ${resp.status}: ${errMsg}`);
    return { success: false, error: errMsg, retryable: resp.status === 408 };
  }

  const markdown = data?.data?.markdown || data?.markdown || '';
  const cached = data?.data?.metadata?.cacheState === 'hit';
  console.log(`Firecrawl got ${markdown.length} chars (cached: ${cached})`);

  if (markdown.length < 50) {
    return { success: false, error: 'No meaningful content from Firecrawl' };
  }

  return { success: true, text: markdown, cached };
}

async function tryDirectFetch(url: string): Promise<{ success: boolean; text?: string; error?: string }> {
  console.log('Trying direct PDF fetch for:', url);
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/pdf,*/*',
      },
      redirect: 'follow',
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.log(`Direct fetch failed ${resp.status}: ${body.substring(0, 100)}`);
      return { success: false, error: `HTTP ${resp.status}` };
    }

    const contentType = resp.headers.get('content-type') || '';
    console.log(`Direct fetch content-type: ${contentType}, status: ${resp.status}`);

    // If we got HTML back (anti-bot page), it's not a PDF
    if (contentType.includes('text/html')) {
      const html = await resp.text();
      if (html.includes('Incapsula') || html.includes('_Incapsula_Resource') || html.length < 500) {
        console.log('Got Incapsula block page');
        return { success: false, error: 'Blocked by anti-bot' };
      }
      return { success: true, text: html };
    }

    // For PDFs: instead of loading into memory (causes OOM on large files),
    // just confirm it's accessible and return a marker with the URL
    // The extract-motions function will use Firecrawl or the URL directly
    const contentLength = resp.headers.get('content-length');
    console.log(`PDF confirmed accessible, size: ${contentLength || 'unknown'} bytes`);
    
    // Consume the body to avoid resource leak
    await resp.arrayBuffer();
    
    return { success: true, text: `[PDF_URL]:${url}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Direct fetch failed';
    console.log('Direct fetch error:', msg);
    return { success: false, error: msg };
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

    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Strategy 1: Firecrawl
    const fcResult = await tryFirecrawl(url, apiKey);
    if (fcResult.success) {
      return new Response(
        JSON.stringify({ success: true, text: fcResult.text, cached: fcResult.cached }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Firecrawl failed, trying direct fetch...');

    // Strategy 2: Direct PDF download (may work for some URLs despite anti-bot)
    const directResult = await tryDirectFetch(url);
    if (directResult.success) {
      return new Response(
        JSON.stringify({ success: true, text: directResult.text, cached: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('All strategies failed');

    // Return the Firecrawl error (more informative), mark as retryable
    return new Response(
      JSON.stringify({
        success: false,
        error: fcResult.error || directResult.error || 'All scrape methods failed',
        retryable: fcResult.retryable ?? true,
      }),
      { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
