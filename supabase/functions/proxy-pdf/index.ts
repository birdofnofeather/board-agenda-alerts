const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

    console.log('Scraping:', url);

    // Firecrawl handles anti-bot (headless browser, proxy rotation, challenge solving)
    // It also caches results, so retries for previously-scraped PDFs are instant
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
      return new Response(
        JSON.stringify({ success: false, error: errMsg, retryable: resp.status === 408 }),
        { status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const markdown = data?.data?.markdown || data?.markdown || '';
    const cached = data?.data?.metadata?.cacheState === 'hit';
    console.log(`Got ${markdown.length} chars (cached: ${cached})`);

    if (markdown.length < 50) {
      return new Response(
        JSON.stringify({ success: false, error: 'No meaningful content extracted' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, text: markdown, cached }),
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
