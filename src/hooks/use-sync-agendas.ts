import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { extractTextFromPdfUrl } from "@/lib/pdf-extract";
import type { Meeting } from "@/lib/types";

interface SyncResult {
  meeting_id: string;
  cluster: string;
  date: string;
  scrape_success: boolean;
  technique: string;
  motions_found: number;
  error?: string;
}

export function useSyncAgendas() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState("");
  const [lastResults, setLastResults] = useState<SyncResult[] | null>(null);
  const queryClient = useQueryClient();

  const sync = async (meetings: Meeting[]) => {
    setIsSyncing(true);
    const results: SyncResult[] = [];

    try {
      for (let i = 0; i < meetings.length; i++) {
        const meeting = meetings[i];
        setProgress(`Processing ${i + 1}/${meetings.length}: ${meeting.cluster} (${meeting.meeting_date})`);

        // Step 1: Extract text from PDF using the browser
        let pdfText: string;
        try {
          pdfText = await extractTextFromPdfUrl(meeting.agenda_pdf_url);
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : "PDF extraction failed";
          console.error(`Failed to extract PDF for ${meeting.cluster}:`, errMsg);
          results.push({
            meeting_id: meeting.id,
            cluster: meeting.cluster,
            date: meeting.meeting_date,
            scrape_success: false,
            technique: "browser-pdfjs",
            motions_found: 0,
            error: errMsg,
          });
          continue;
        }

        if (pdfText.length < 100) {
          results.push({
            meeting_id: meeting.id,
            cluster: meeting.cluster,
            date: meeting.meeting_date,
            scrape_success: false,
            technique: "browser-pdfjs",
            motions_found: 0,
            error: "PDF text too short - may be scanned/image-only",
          });
          continue;
        }

        // Step 2: Send to AI for motion extraction
        setProgress(`Analyzing ${i + 1}/${meetings.length}: ${meeting.cluster}...`);

        try {
          const { data: extractResult, error: extractError } =
            await supabase.functions.invoke("extract-motions", {
              body: {
                content: pdfText,
                content_type: "text",
                meeting_info: {
                  cluster: meeting.cluster,
                  date: meeting.meeting_date,
                },
              },
            });

          if (extractError) throw extractError;

          const motions = extractResult?.board_motions || [];

          // Step 3: Save to database
          if (motions.length > 0) {
            // Delete existing motions for this meeting
            await supabase
              .from("board_motions")
              .delete()
              .eq("meeting_id", meeting.id);

            await supabase.from("board_motions").insert(
              motions.map(
                (m: {
                  item_number?: string;
                  title: string;
                  summary?: string;
                  backup_page_anchor?: string;
                }) => ({
                  meeting_id: meeting.id,
                  item_number: m.item_number || null,
                  title: m.title,
                  summary: m.summary || null,
                  backup_page_anchor: m.backup_page_anchor || null,
                })
              )
            );
          }

          results.push({
            meeting_id: meeting.id,
            cluster: meeting.cluster,
            date: meeting.meeting_date,
            scrape_success: true,
            technique: "browser-pdfjs",
            motions_found: motions.length,
          });
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : "AI extraction failed";
          results.push({
            meeting_id: meeting.id,
            cluster: meeting.cluster,
            date: meeting.meeting_date,
            scrape_success: true,
            technique: "browser-pdfjs",
            motions_found: 0,
            error: errMsg,
          });
        }
      }

      setLastResults(results);

      const successful = results.filter((r) => r.scrape_success);
      const totalMotions = results.reduce((sum, r) => sum + r.motions_found, 0);

      if (totalMotions > 0) {
        toast.success(
          `Found ${totalMotions} Board Motion Item(s) across ${successful.length} agenda(s)`
        );
      } else if (successful.length > 0) {
        toast.info("Agendas scraped successfully but no Board Motion Items found.");
      } else {
        toast.error("Failed to scrape agendas. The PDFs may be blocked.");
      }

      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      return results;
    } finally {
      setIsSyncing(false);
      setProgress("");
    }
  };

  return { sync, isSyncing, progress, lastResults };
}
