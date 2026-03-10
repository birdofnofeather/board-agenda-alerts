import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { extractTextFromPdfBuffer } from "@/lib/pdf-extract";
import type { Meeting } from "@/lib/types";

interface SyncResult {
  meeting_id: string;
  cluster: string;
  date: string;
  success: boolean;
  technique: string;
  motions_found: number;
  error?: string;
}

export function useSyncAgendas() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState("");
  const [lastResults, setLastResults] = useState<SyncResult[] | null>(null);
  const queryClient = useQueryClient();

  const extractMotionsViaAI = async (
    content: string,
    cluster: string,
    date: string
  ) => {
    const { data, error } = await supabase.functions.invoke("extract-motions", {
      body: { content, content_type: "text", meeting_info: { cluster, date } },
    });
    if (error) throw error;
    return data?.board_motions || [];
  };

  const saveMotions = async (
    meetingId: string,
    motions: Array<{ item_number?: string; title: string; summary?: string; backup_page_anchor?: string }>
  ) => {
    if (motions.length === 0) return;
    await supabase.from("board_motions").delete().eq("meeting_id", meetingId);
    await supabase.from("board_motions").insert(
      motions.map((m) => ({
        meeting_id: meetingId,
        item_number: m.item_number || null,
        title: m.title,
        summary: m.summary || null,
        backup_page_anchor: m.backup_page_anchor || null,
      }))
    );
  };

  const syncMeeting = async (meeting: Meeting): Promise<SyncResult> => {
    const base = { meeting_id: meeting.id, cluster: meeting.cluster, date: meeting.meeting_date };

    try {
      // Use proxy-pdf edge function (fetches + parses PDF server-side)
      const { data, error } = await supabase.functions.invoke("proxy-pdf", {
        body: { url: meeting.agenda_pdf_url },
      });

      if (error || !data?.success) {
        return { ...base, success: false, technique: "proxy-pdf", motions_found: 0, error: data?.error || error?.message || "Proxy failed" };
      }

      // Send extracted text to AI
      const motions = await extractMotionsViaAI(data.text, meeting.cluster, meeting.meeting_date);
      await saveMotions(meeting.id, motions);
      return { ...base, success: true, technique: "proxy-pdf", motions_found: motions.length };
    } catch (e) {
      return { ...base, success: false, technique: "proxy-pdf", motions_found: 0, error: e instanceof Error ? e.message : "Unknown error" };
    }
  };

  const handleManualUpload = async (file: File, meeting: Meeting): Promise<SyncResult> => {
    const base = { meeting_id: meeting.id, cluster: meeting.cluster, date: meeting.meeting_date };
    try {
      const buffer = await file.arrayBuffer();
      const text = await extractTextFromPdfBuffer(buffer);
      if (text.length < 50) {
        return { ...base, success: false, technique: "manual-upload", motions_found: 0, error: "PDF has no extractable text" };
      }
      const motions = await extractMotionsViaAI(text, meeting.cluster, meeting.meeting_date);
      await saveMotions(meeting.id, motions);
      return { ...base, success: true, technique: "manual-upload", motions_found: motions.length };
    } catch (e) {
      return { ...base, success: false, technique: "manual-upload", motions_found: 0, error: e instanceof Error ? e.message : "Upload failed" };
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
      }

      setLastResults(results);
      const successful = results.filter((r) => r.success);
      const totalMotions = results.reduce((sum, r) => sum + r.motions_found, 0);

      if (totalMotions > 0) {
        toast.success(`Found ${totalMotions} Board Motion Item(s) across ${successful.length} agenda(s)`);
      } else if (successful.length > 0) {
        toast.info("Agendas processed but no Board Motion Items found.");
      } else {
        toast.error("Could not access PDFs. Try uploading them manually.");
      }

      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      return results;
    } finally {
      setIsSyncing(false);
      setProgress("");
    }
  };

  return { sync, isSyncing, progress, lastResults, handleManualUpload };
}
