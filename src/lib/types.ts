import { Database } from "@/integrations/supabase/types";

export type ClusterType = Database["public"]["Enums"]["cluster_type"];

export type Meeting = Database["public"]["Tables"]["meetings"]["Row"];
export type BoardMotion = Database["public"]["Tables"]["board_motions"]["Row"];

export type MeetingWithMotions = Meeting & {
  board_motions: BoardMotion[];
};

export const CLUSTER_LABELS: Record<ClusterType, string> = {
  operations: "Operations",
  community_services: "Community Services",
  family_social_services: "Family & Social Services",
  health_mental_health: "Health & Mental Health",
};

export const CLUSTER_COLORS: Record<ClusterType, string> = {
  operations: "bg-cluster-operations",
  community_services: "bg-cluster-community",
  family_social_services: "bg-cluster-family",
  health_mental_health: "bg-cluster-health",
};
