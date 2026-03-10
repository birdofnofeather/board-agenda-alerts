import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Map page section headings to our cluster_type enum
const CLUSTER_MAP: Record<string, string> = {
  'operations cluster': 'operations',
  'community services cluster': 'community_services',
  'family & social services cluster': 'family_social_services',
  'family and social services cluster': 'family_social_services',
  'health & mental health services cluster': 'health_mental_health',
  'health and mental health services cluster': 'health_mental_health',
  'health/mental health services cluster': 'health_mental_health',
};

interface ParsedEntry {
  cluster: string;
  date: string; // YYYY-MM-DD
  url: string;
  label: string;
  isCancelled: boolean;
}

function parseDate(label: string): string | null {
  // Try to extract a date like "March 11, 2026" from the label
  const match = label.match(
    /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i
  );
  if (!match) return null;

  const d = new Date(match[0].replace(',', ','));
  if (isNaN(d.getTime())) return null;

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseAgendaPage(markdown: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  const lines = markdown.split('\n');

  let currentCluster: string | null = null;

  for (const line of lines) {
    // Detect cluster headings like "#### Operations Cluster"
    const headingMatch = line.match(/^#{1,5}\s+(.+)/);
    if (headingMatch) {
      const heading = headingMatch[1].trim().toLowerCase();
      for (const [key, value] of Object.entries(CLUSTER_MAP)) {
        if (heading.includes(key)) {
          currentCluster = value;
          break;
        }
      }
      continue;
    }

    if (!currentCluster) continue;

    // Find markdown links: [Label](URL)
    // Only grab the first link per line (the agenda PDF, not presentations)
    const linkMatch = line.match(/\[([^\]]+)\]\((https?:\/\/[^)]+\.pdf[^)]*)\)/i);
    if (!linkMatch) continue;

    const label = linkMatch[1].trim();
    let url = linkMatch[2].trim();

    // Remove tracking params
    url = url.split('?')[0];

    const date = parseDate(label);
    if (!date) continue;

    const isCancelled = /cancel/i.test(label);

    entries.push({ cluster: currentCluster, date, url, label, isCancelled });
  }

  return entries;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const fcKey = Deno.env.get('FIRECRAWL_API_KEY');

    if (!fcKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'FIRECRAWL_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 1: Scrape the agendas page
    console.log('Scraping ceo.lacounty.gov/agendas/ ...');
    const fcResp = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${fcKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://ceo.lacounty.gov/agendas/',
        formats: ['markdown'],
        onlyMainContent: false,
        timeout: 60000,
      }),
    });

    const fcData = await fcResp.json();
    const markdown = fcData?.data?.markdown || fcData?.markdown || '';

    if (markdown.length < 100) {
      console.error('Firecrawl returned insufficient content');
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to scrape agendas page' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Got ${markdown.length} chars from agendas page`);

    // Step 2: Parse for recent entries (top 3 per cluster)
    const allEntries = parseAgendaPage(markdown);
    console.log(`Parsed ${allEntries.length} total entries across all clusters`);

    // Get top 3 per cluster (most recent)
    const recentByCluster: Record<string, ParsedEntry[]> = {};
    for (const entry of allEntries) {
      if (!recentByCluster[entry.cluster]) recentByCluster[entry.cluster] = [];
      if (recentByCluster[entry.cluster].length < 3) {
        recentByCluster[entry.cluster].push(entry);
      }
    }

    const recentEntries = Object.values(recentByCluster).flat();
    console.log(`Checking ${recentEntries.length} recent entries for new agendas`);

    // Step 3: Check which URLs we already have
    const { data: existingMeetings } = await supabase
      .from('meetings')
      .select('agenda_pdf_url');

    const existingUrls = new Set((existingMeetings || []).map((m: { agenda_pdf_url: string }) => m.agenda_pdf_url));

    const newEntries = recentEntries.filter((e) => !existingUrls.has(e.url));
    console.log(`Found ${newEntries.length} new agenda(s)`);

    if (newEntries.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No new agendas found', new_count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 4: Insert new meetings
    const toInsert = newEntries.map((e) => ({
      cluster: e.cluster,
      meeting_date: e.date,
      agenda_pdf_url: e.url,
      is_cancelled: e.isCancelled,
    }));

    const { data: inserted, error: insertError } = await supabase
      .from('meetings')
      .insert(toInsert)
      .select('id');

    if (insertError) {
      console.error('Insert error:', insertError);
      return new Response(
        JSON.stringify({ success: false, error: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const newIds = (inserted || []).map((m: { id: string }) => m.id);
    console.log(`Inserted ${newIds.length} new meetings, triggering sync...`);

    // Step 5: Trigger sync-agendas for the new meetings
    const baseUrl = supabaseUrl.replace(/\/$/, '');
    try {
      await fetch(`${baseUrl}/functions/v1/sync-agendas`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ meeting_ids: newIds }),
      });
    } catch (e) {
      console.warn('Sync trigger failed (will be picked up on next page load):', e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        new_count: newIds.length,
        new_meetings: newEntries.map((e) => ({ cluster: e.cluster, date: e.date })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Check error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
