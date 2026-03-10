import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import type { Meeting } from "@/lib/types";

interface SyncStatus {
  state: "idle" | "syncing" | "success" | "error";
  lastUpdated: string | null;
  errorMessage?: string;
}

interface SyncResult {
  meeting_id: string;
  cluster: string;
  date: string;
  success: boolean;
  motions_found: number;
  error?: string;
  retryable?: boolean;
}

export function useSyncAgendas(meetings: Meeting[] | undefined) {
  const [status, setStatus] = useState<SyncStatus>({ state: "idle", lastUpdated: null });
  const queryClient = useQueryClient();
  const hasRun = useRef(false);

  const syncMeeting = async (meeting: Meeting): Promise<SyncResult> => {
    const base = { meeting_id: meeting.id, cluster: meeting.cluster, date: meeting.meeting_date };

    try {
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

      const { data: extractResult, error: extractError } = await supabase.functions.invoke("extract-motions", {
        body: {
          content: data.text,
          content_type: "text",
          meeting_info: { cluster: meeting.cluster, date: meeting.meeting_date },
        },
      });

      if (extractError) throw extractError;

      const motions = extractResult?.board_motions || [];

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

  useEffect(() => {
    if (!meetings || hasRun.current) return;

    const pending = meetings.filter((m) => {
      // We need to check if this meeting already has motions — but we only have Meeting[], not MeetingWithMotions[]
      // The caller should pass only meetings needing sync
      return true;
    });

    if (pending.length === 0) {
      setStatus({ state: "success", lastUpdated: new Date().toISOString() });
      return;
    }

    hasRun.current = true;

    const run = async () => {
      setStatus({ state: "syncing", lastUpdated: null });
      const results: SyncResult[] = [];
      let hadFailures = false;

      for (let i = 0; i < pending.length; i++) {
        const result = await syncMeeting(pending[i]);
        results.push(result);

        if (!result.success) hadFailures = true;

        // Throttle between requests
        if (i < pending.length - 1) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }

      // Retry failed retryable ones once after a longer delay
      const retryable = results.filter((r) => !r.success && r.retryable);
      if (retryable.length > 0) {
        await new Promise((r) => setTimeout(r, 10000));
        for (let i = 0; i < retryable.length; i++) {
          const meeting = pending.find((m) => m.id === retryable[i].meeting_id);
          if (!meeting) continue;
          const retryResult = await syncMeeting(meeting);
          // Update the result in place
          const idx = results.findIndex((r) => r.meeting_id === meeting.id);
          if (idx >= 0) results[idx] = retryResult;

          if (i < retryable.length - 1) {
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
      }

      const anyFailed = results.some((r) => !r.success);
      const now = new Date().toISOString();

      if (anyFailed) {
        const failedCount = results.filter((r) => !r.success).length;
        setStatus({ state: "error", lastUpdated: now, errorMessage: `${failedCount} agenda(s) failed to sync` });
      } else {
        setStatus({ state: "success", lastUpdated: now });
      }

      queryClient.invalidateQueries({ queryKey: ["meetings"] });
    };

    run();
  }, [meetings]);

  return status;
}
