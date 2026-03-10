import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface SyncResult {
  meeting_id: string;
  cluster: string;
  date: string;
  scrape_success: boolean;
  scrape_technique?: string;
  motions_found: number;
  error?: string;
}

export function useSyncAgendas() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastResults, setLastResults] = useState<SyncResult[] | null>(null);
  const queryClient = useQueryClient();

  const sync = async (meetingIds?: string[]) => {
    setIsSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-agendas", {
        body: { meeting_ids: meetingIds || [] },
      });

      if (error) throw error;

      const results: SyncResult[] = data?.results || [];
      setLastResults(results);

      const successful = results.filter((r) => r.scrape_success);
      const totalMotions = results.reduce((sum, r) => sum + r.motions_found, 0);

      if (successful.length > 0) {
        toast.success(
          `Synced ${successful.length} meeting(s), found ${totalMotions} Board Motion Item(s)`
        );
      } else if (results.length > 0) {
        toast.error("All scraping attempts failed. Check the results for details.");
      } else {
        toast.info("All meetings already have motions data.");
      }

      // Refresh meetings data
      queryClient.invalidateQueries({ queryKey: ["meetings"] });

      return results;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sync failed";
      toast.error(msg);
      return [];
    } finally {
      setIsSyncing(false);
    }
  };

  return { sync, isSyncing, lastResults };
}
