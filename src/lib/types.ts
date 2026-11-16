export type ClusterType =
  | "operations"
  | "community_services"
  | "family_social_services"
  | "health_mental_health";

export interface BoardMotion {
  id: string;
  item_number: string | null;
  title: string;
  summary: string | null;
  backup_page_anchor: string | null;
  /** Full text of the motion. The search uses this text. */
  backup_text: string;
}

export interface Meeting {
  id: string;
  cluster: ClusterType;
  meeting_date: string;
  meeting_time: string | null;
  agenda_pdf_url: string;
  /** Label from the county agenda list, for example "Revised Agenda". */
  agenda_label: string | null;
  teams_link: string | null;
  is_cancelled: boolean;
  updated_at: string;
  /** Number of times that the county replaced the agenda file. */
  revisions: number;
}

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
