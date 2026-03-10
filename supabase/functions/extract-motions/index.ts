const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const AI_GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

const EXTRACTION_PROMPT = `You are an expert at reading LA County CEO cluster meeting agendas. Your job is to identify all "Board Motion Items" (also sometimes labeled "Board Letter", "Board Motion", or items that reference a motion going to the Board of Supervisors).

For each Board Motion Item found, extract:
1. item_number: The agenda item number (e.g., "3A", "2B", "4A")
2. title: The full title of the motion/item
3. summary: A 2-3 sentence summary explaining what the motion does, what it requests, and key details from any backup materials
4. backup_page_anchor: The page number where the backup/supporting materials begin (if identifiable)

IMPORTANT:
- Only extract items that are specifically "Board Motion Items" or "Board Letters" — not regular agenda items
- If no Board Motion Items exist in this agenda, return an empty array
- Be precise with page numbers for backup materials

Return your response as valid JSON in this exact format:
{
  "board_motions": [
    {
      "item_number": "3A",
      "title": "Title of the motion",
      "summary": "Summary of what the motion does...",
      "backup_page_anchor": "5"
    }
  ]
}

If the content appears to be garbled, a challenge page, or not an actual agenda, return:
{
  "board_motions": [],
  "error": "Content does not appear to be a valid meeting agenda"
}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { content, content_type, meeting_info } = await req.json();

    if (!content) {
      return new Response(
        JSON.stringify({ success: false, error: 'Content is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'LOVABLE_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build the user message based on content type
    let textContent = content;
    
    if (content_type === 'pdf_url') {
      // PDF was too large to base64 — fetch via Firecrawl from extract-motions
      console.log('Fetching PDF content via Firecrawl from extract-motions for:', content);
      const fcKey = Deno.env.get('FIRECRAWL_API_KEY');
      if (fcKey) {
        try {
          const fcResp = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${fcKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url: content,
              formats: ['markdown'],
              onlyMainContent: false,
              timeout: 90000,
            }),
          });
          const fcData = await fcResp.json();
          const markdown = fcData?.data?.markdown || fcData?.markdown || '';
          if (markdown.length > 50) {
            textContent = markdown;
            console.log(`Got ${markdown.length} chars from Firecrawl in extract-motions`);
          } else {
            console.log('Firecrawl returned insufficient content in extract-motions');
          }
        } catch (e) {
          console.log('Firecrawl fetch failed in extract-motions:', e);
        }
      }
    }

    const userMessage = `Here is the content of an LA County CEO cluster meeting agenda (${meeting_info?.cluster || 'unknown cluster'}, date: ${meeting_info?.date || 'unknown'}).

Please analyze it and extract all Board Motion Items.

${textContent.substring(0, 50000)}`;

    const messages: Array<{ role: string; content: unknown }> = [];
    messages.push(
      { role: 'system', content: EXTRACTION_PROMPT },
      { role: 'user', content: userMessage }
    );

    console.log('Calling AI to extract motions...');

    const aiResp = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error('AI Gateway error:', errText);
      return new Response(
        JSON.stringify({ success: false, error: `AI Gateway error: ${aiResp.status}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResp.json();
    const responseText = aiData?.choices?.[0]?.message?.content || '';

    // Parse the JSON response
    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to parse AI response', raw: responseText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log(`Extracted ${parsed.board_motions?.length || 0} motions`);

    return new Response(
      JSON.stringify({ success: true, ...parsed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Extract error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
