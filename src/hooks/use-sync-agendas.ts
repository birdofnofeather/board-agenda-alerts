import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Meeting } from "@/lib/types";

interface SyncResult {
  meeting_id: string;
  cluster: string;
  date: string;
  success: boolean;
  motions_found: number;
  error?: string;
  retryable?: boolean;
}

export function useSyncAgendas() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState("");
  const queryClient = useQueryClient();

  const syncMeeting = async (meeting: Meeting): Promise<SyncResult> => {
    const base = { meeting_id: meeting.id, cluster: meeting.cluster, date: meeting.meeting_date };

    try {
      // Scrape PDF via Firecrawl (handles anti-bot, caches results)
      const { data, error } = await supabase.functions.invoke("proxy-pdf", {
        body: { url: meeting.agenda_pdf_url },
      });

      if (error || !data?.success) {
        return {
          ...base,
          success: false,
          motions_found: 0,
          error: data?.error || error?.message || "Scrape failed",
          retryable: data?.retryable ?? true,
        };
      }

      // Extract motions via AI
      const { data: extractResult, error: extractError } = await supabase.functions.invoke("extract-motions", {
        body: {
          content: data.text,
          content_type: "text",
          meeting_info: { cluster: meeting.cluster, date: meeting.meeting_date },
        },
      });

      if (extractError) throw extractError;

      const motions = extractResult?.board_motions || [];

      // Save to DB (replace existing)
      await supabase.from("board_motions").delete().eq("meeting_id", meeting.id);
      if (motions.length > 0) {
        await supabase.from("board_motions").insert(
          motions.map((m: { item_number?: string; title: string; summary?: string; backup_page_anchor?: string }) => ({
            meeting_id: meeting.id,
            item_number: m.item_number || null,
            title: m.title,
            summary: m.summary || null,
            backup_page_anchor: m.backup_page_anchor || null,
          }))
        );
      }

      return { ...base, success: true, motions_found: motions.length };
    } catch (e) {
      return { ...base, success: false, motions_found: 0, error: e instanceof Error ? e.message : "Unknown error" };
    }
  };

  const sync = async (meetings: Meeting[]) => {
    setIsSyncing(true);
    const results: SyncResult[] = [];

    try {
      for (let i = 0; i < meetings.length; i++) {
        const meeting = meetings[i];
        setProgress(`Processing ${i + 1}/${meetings.length}: ${meeting.cluster} (${meeting.meeting_date})`);

        const result = await syncMeeting(meeting);
        results.push(result);

        // 3-second throttle between meetings
        if (i < meetings.length - 1) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }

      const successful = results.filter((r) => r.success);
      const totalMotions = results.reduce((sum, r) => sum + r.motions_found, 0);
      const failed = results.filter((r) => !r.success);
      const retryable = failed.filter((r) => r.retryable);

      if (totalMotions > 0) {
        toast.success(`Found ${totalMotions} Board Motion Item(s) across ${successful.length} agenda(s)`);
      } else if (successful.length > 0) {
        toast.info("Agendas processed — no Board Motion Items found in these agendas.");
      }

      if (failed.length > 0) {
        const msg = retryable.length > 0
          ? `${failed.length} agenda(s) timed out. Firecrawl is caching them — retry in a minute.`
          : `${failed.length} agenda(s) could not be scraped.`;
        toast.warning(msg);
      }

      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      return results;
    } finally {
      setIsSyncing(false);
      setProgress("");
    }
  };

  return { sync, isSyncing, progress };
}
