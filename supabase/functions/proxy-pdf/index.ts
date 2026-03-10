import pdf from 'npm:pdf-parse/lib/pdf-parse.js';

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

    console.log('Fetching PDF:', url);

    // Direct fetch with browser-like headers
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/pdf,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://ceo.lacounty.gov/agendas/',
      },
      redirect: 'follow',
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error('Fetch failed:', resp.status, body.substring(0, 200));
      return new Response(
        JSON.stringify({ success: false, error: `Fetch failed with status ${resp.status}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const contentType = resp.headers.get('content-type') || '';

    // Check if we got an Incapsula challenge page instead
    if (contentType.includes('text/html')) {
      const html = await resp.text();
      if (html.includes('Incapsula') || html.includes('_Incapsula') || html.includes('reese84')) {
        return new Response(
          JSON.stringify({ success: false, error: 'Blocked by Incapsula bot protection' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ success: false, error: 'Got HTML instead of PDF' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse the PDF
    const buffer = await resp.arrayBuffer();
    console.log(`Got PDF: ${buffer.byteLength} bytes, parsing text...`);

    const data = await pdf(buffer);
    const text = data.text || '';
    console.log(`Extracted ${text.length} chars of text from ${data.numpages} pages`);

    if (text.length < 50) {
      return new Response(
        JSON.stringify({ success: false, error: 'PDF has no extractable text (may be scanned/image-only)' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        text,
        metadata: {
          pages: data.numpages,
          size: buffer.byteLength,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
