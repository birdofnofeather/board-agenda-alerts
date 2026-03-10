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

    console.log('Scraping PDF via Firecrawl:', url);

    // Use Firecrawl which has built-in anti-bot (headless browser, proxy rotation)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000); // 55s (edge fn limit ~60s)

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
        timeout: 50000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await response.json();

    if (!response.ok) {
      console.error('Firecrawl error:', JSON.stringify(data));
      return new Response(
        JSON.stringify({ success: false, error: data.error || `Firecrawl returned ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const markdown = data?.data?.markdown || data?.markdown || '';
    console.log(`Firecrawl returned ${markdown.length} chars of markdown`);

    return new Response(
      JSON.stringify({ success: true, markdown, metadata: data?.data?.metadata || data?.metadata }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const isTimeout = msg.includes('abort');
    console.error('Proxy error:', msg);
    return new Response(
      JSON.stringify({ success: false, error: isTimeout ? 'Request timed out - Firecrawl could not bypass bot protection in time' : msg }),
      { status: isTimeout ? 504 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
