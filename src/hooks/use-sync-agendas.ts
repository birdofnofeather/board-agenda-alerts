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
}

export function useSyncAgendas() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState("");
  const queryClient = useQueryClient();

  const syncMeeting = async (meeting: Meeting): Promise<SyncResult> => {
    const base = { meeting_id: meeting.id, cluster: meeting.cluster, date: meeting.meeting_date };

    try {
      // Step 1: Scrape PDF via server-side proxy (handles retries + throttle)
      const { data, error } = await supabase.functions.invoke("proxy-pdf", {
        body: { url: meeting.agenda_pdf_url },
      });

      if (error || !data?.success) {
        return { ...base, success: false, motions_found: 0, error: data?.error || error?.message || "Scrape failed" };
      }

      // Step 2: Extract motions via AI
      const { data: extractResult, error: extractError } = await supabase.functions.invoke("extract-motions", {
        body: {
          content: data.text,
          content_type: "text",
          meeting_info: { cluster: meeting.cluster, date: meeting.meeting_date },
        },
      });

      if (extractError) throw extractError;

      const motions = extractResult?.board_motions || [];

      // Step 3: Save to DB
      if (motions.length > 0) {
        await supabase.from("board_motions").delete().eq("meeting_id", meeting.id);
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

        // Small delay between meetings to avoid hammering
        if (i < meetings.length - 1) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      const successful = results.filter((r) => r.success);
      const totalMotions = results.reduce((sum, r) => sum + r.motions_found, 0);
      const failed = results.filter((r) => !r.success);

      if (totalMotions > 0) {
        toast.success(`Found ${totalMotions} Board Motion Item(s) across ${successful.length} agenda(s)`);
      } else if (successful.length > 0) {
        toast.info("Agendas processed — no Board Motion Items found.");
      }

      if (failed.length > 0 && failed.length < results.length) {
        toast.warning(`${failed.length} agenda(s) could not be scraped.`);
      } else if (failed.length === results.length) {
        toast.error("All scraping attempts failed.");
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
