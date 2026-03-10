import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import type { MeetingWithMotions } from "@/lib/types";

export function useMeetings() {
  return useQuery({
    queryKey: ["meetings"],
    queryFn: async (): Promise<MeetingWithMotions[]> => {
      const { data: meetings, error: meetingsError } = await supabase
        .from("meetings")
        .select("*")
        .order("meeting_date", { ascending: false });

      if (meetingsError) throw meetingsError;

      const { data: motions, error: motionsError } = await supabase
        .from("board_motions")
        .select("*");

      if (motionsError) throw motionsError;

      return (meetings || []).map((m) => ({
        ...m,
        board_motions: (motions || []).filter((b) => b.meeting_id === m.id),
      }));
    },
  });
}
