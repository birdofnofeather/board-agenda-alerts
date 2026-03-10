import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { meeting_ids } = await req.json();

    // Get meetings to process
    let query = supabase.from('meetings').select('*');
    if (meeting_ids?.length) {
      query = query.in('id', meeting_ids);
    } else {
      // Default: process meetings that have no board motions yet
      const { data: allMeetings } = await supabase.from('meetings').select('id');
      const { data: existingMotions } = await supabase.from('board_motions').select('meeting_id');
      
      const meetingsWithMotions = new Set((existingMotions || []).map(m => m.meeting_id));
      const missingIds = (allMeetings || [])
        .filter(m => !meetingsWithMotions.has(m.id))
        .map(m => m.id);
      
      if (missingIds.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: 'All meetings already have motions data', results: [] }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      query = supabase.from('meetings').select('*').in('id', missingIds);
    }

    const { data: meetings, error: meetingsError } = await query;
    if (meetingsError) throw meetingsError;

    const results: Array<{
      meeting_id: string;
      cluster: string;
      date: string;
      scrape_success: boolean;
      scrape_technique?: string;
      motions_found: number;
      error?: string;
    }> = [];

    const baseUrl = supabaseUrl.replace(/\/$/, '');

    for (const meeting of meetings || []) {
      console.log(`\n=== Processing: ${meeting.cluster} on ${meeting.meeting_date} ===`);
      console.log(`PDF URL: ${meeting.agenda_pdf_url}`);

      // Step 1: Scrape the PDF
      let scrapeResult;
      try {
        const scrapeResp = await fetch(`${baseUrl}/functions/v1/scrape-pdf`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url: meeting.agenda_pdf_url }),
        });

        scrapeResult = await scrapeResp.json();
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : 'Scrape call failed';
        console.error('Scrape failed:', errMsg);
        results.push({
          meeting_id: meeting.id,
          cluster: meeting.cluster,
          date: meeting.meeting_date,
          scrape_success: false,
          motions_found: 0,
          error: errMsg,
        });
        continue;
      }

      if (!scrapeResult?.success) {
        console.error('All scrape techniques failed for', meeting.agenda_pdf_url);
        results.push({
          meeting_id: meeting.id,
          cluster: meeting.cluster,
          date: meeting.meeting_date,
          scrape_success: false,
          motions_found: 0,
          error: `Scrape failed: ${scrapeResult?.error || 'Unknown'}`,
        });
        continue;
      }

      const content = scrapeResult.result?.markdown || scrapeResult.result?.rawText || '';
      const isPdfBase64 = content.startsWith('[PDF_BASE64]:');
      const contentForAI = isPdfBase64 ? content.substring('[PDF_BASE64]:'.length) : content;

      console.log(`Scraped successfully via: ${scrapeResult.result?.technique}, content length: ${content.length}`);

      // Step 2: Extract motions via AI
      let extractResult;
      try {
        const extractResp = await fetch(`${baseUrl}/functions/v1/extract-motions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: contentForAI,
            content_type: isPdfBase64 ? 'pdf_base64' : 'text',
            meeting_info: {
              cluster: meeting.cluster,
              date: meeting.meeting_date,
            },
          }),
        });

        extractResult = await extractResp.json();
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : 'Extract call failed';
        console.error('Extraction failed:', errMsg);
        results.push({
          meeting_id: meeting.id,
          cluster: meeting.cluster,
          date: meeting.meeting_date,
          scrape_success: true,
          scrape_technique: scrapeResult.result?.technique,
          motions_found: 0,
          error: errMsg,
        });
        continue;
      }

      const motions = extractResult?.board_motions || [];
      console.log(`Found ${motions.length} board motions`);

      // Step 3: Save motions to database
      if (motions.length > 0) {
        // Delete existing motions for this meeting first
        await supabase
          .from('board_motions')
          .delete()
          .eq('meeting_id', meeting.id);

        const { error: insertError } = await supabase
          .from('board_motions')
          .insert(
            motions.map((m: { item_number?: string; title: string; summary?: string; backup_page_anchor?: string }) => ({
              meeting_id: meeting.id,
              item_number: m.item_number || null,
              title: m.title,
              summary: m.summary || null,
              backup_page_anchor: m.backup_page_anchor || null,
            }))
          );

        if (insertError) {
          console.error('Insert error:', insertError);
        }
      }

      results.push({
        meeting_id: meeting.id,
        cluster: meeting.cluster,
        date: meeting.meeting_date,
        scrape_success: true,
        scrape_technique: scrapeResult.result?.technique,
        motions_found: motions.length,
      });
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Sync error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
