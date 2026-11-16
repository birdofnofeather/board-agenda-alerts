import { useQuery } from "@tanstack/react-query";
import type { BoardResult, ClusterType, MeetingWithMotions } from "@/lib/types";

/** One agenda in public/data/agendas.json. The daily job on GitHub writes this file. */
interface ArchiveRecord {
  cluster: ClusterType;
  date: string;
  url: string;
  label?: string;
  meeting_time: string | null;
  teams_link: string | null;
  is_cancelled: boolean;
  processed_at: string;
  history?: unknown[];
  motions: {
    item_number: string | null;
    title: string;
    summary: string | null;
    backup_page: number | null;
    backup_text?: string;
    board?: BoardResult;
  }[];
}

export function useMeetings() {
  return useQuery({
    queryKey: ["meetings"],
    queryFn: async (): Promise<MeetingWithMotions[]> => {
      const response = await fetch(`${import.meta.env.BASE_URL}data/agendas.json`, { cache: "no-cache" });
      if (!response.ok) throw new Error(`Could not load the agenda data (${response.status})`);
      const archive: Record<string, ArchiveRecord> = await response.json();

      return Object.entries(archive)
        .map(([key, r]) => ({
          id: key,
          cluster: r.cluster,
          meeting_date: r.date,
          meeting_time: r.meeting_time,
          agenda_pdf_url: r.url,
          agenda_label: r.label || null,
          teams_link: r.teams_link,
          is_cancelled: r.is_cancelled,
          updated_at: r.processed_at,
          revisions: r.history?.length || 0,
          board_motions: r.motions.map((m, i) => ({
            id: `${key}|${i}`,
            item_number: m.item_number,
            title: m.title,
            summary: m.summary,
            backup_page_anchor: m.backup_page ? String(m.backup_page) : null,
            backup_text: m.backup_text || "",
            board: m.board || { status: "no_board_data" },
          })),
        }))
        .sort((a, b) => b.meeting_date.localeCompare(a.meeting_date) || a.cluster.localeCompare(b.cluster));
    },
  });
}

export interface TrackerStatus {
  last_run: string;
  ai_available: boolean;
  problems: string[];
}

/** The record of the last run of the daily job. */
export function useTrackerStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: async (): Promise<TrackerStatus | null> => {
      const response = await fetch(`${import.meta.env.BASE_URL}data/status.json`, { cache: "no-cache" });
      return response.ok ? response.json() : null;
    },
  });
}
