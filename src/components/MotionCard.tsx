import { useState } from "react";
import { ChevronDown, FileText, Video, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import type { MeetingWithMotions } from "@/lib/types";
import { CLUSTER_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";

const clusterBorderColors: Record<string, string> = {
  operations: "border-l-cluster-operations",
  community_services: "border-l-cluster-community",
  family_social_services: "border-l-cluster-family",
  health_mental_health: "border-l-cluster-health",
};

const clusterBadgeBg: Record<string, string> = {
  operations: "bg-cluster-operations/10 text-cluster-operations",
  community_services: "bg-cluster-community/10 text-cluster-community",
  family_social_services: "bg-cluster-family/10 text-cluster-family",
  health_mental_health: "bg-cluster-health/10 text-cluster-health",
};

interface MotionCardProps {
  meeting: MeetingWithMotions;
}

export function MotionCard({ meeting }: MotionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hasMotions = meeting.board_motions.length > 0;
  const meetingDate = new Date(meeting.meeting_date + "T00:00:00");

  if (!hasMotions) return null;

  return (
    <div
      className={cn(
        "bg-card rounded-lg border border-border shadow-sm overflow-hidden transition-all duration-200 hover:shadow-md",
        "border-l-4",
        clusterBorderColors[meeting.cluster]
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-5 flex items-start justify-between gap-4"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span
              className={cn(
                "text-xs font-semibold px-2.5 py-0.5 rounded-full uppercase tracking-wide",
                clusterBadgeBg[meeting.cluster]
              )}
            >
              {CLUSTER_LABELS[meeting.cluster]}
            </span>
            {meeting.is_cancelled && (
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-destructive/10 text-destructive uppercase tracking-wide">
                Cancelled
              </span>
            )}
          </div>

          <h3 className="font-heading text-lg font-semibold text-foreground leading-tight">
            {meeting.board_motions.map((m) => m.title).join("; ")}
          </h3>

          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
            {meeting.teams_link ? (
              <a
                href={meeting.teams_link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 hover:text-primary transition-colors"
              >
                <Video className="h-3.5 w-3.5" />
                {format(meetingDate, "MMMM d, yyyy")}{" "}
                {meeting.meeting_time && `at ${meeting.meeting_time}`}
              </a>
            ) : (
              <span className="flex items-center gap-1">
                {format(meetingDate, "MMMM d, yyyy")}{" "}
                {meeting.meeting_time && `at ${meeting.meeting_time}`}
              </span>
            )}
          </div>
        </div>

        <ChevronDown
          className={cn(
            "h-5 w-5 text-muted-foreground shrink-0 transition-transform duration-200 mt-1",
            expanded && "rotate-180"
          )}
        />
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-border/50 pt-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          {meeting.board_motions.map((motion) => (
            <div key={motion.id} className="space-y-2">
              {motion.item_number && (
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Item {motion.item_number}
                </p>
              )}
              <h4 className="font-semibold text-foreground">{motion.title}</h4>
              {motion.summary && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {motion.summary}
                </p>
              )}
              {motion.backup_page_anchor && (
                <a
                  href={`${meeting.agenda_pdf_url}#page=${motion.backup_page_anchor}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
                >
                  <FileText className="h-3.5 w-3.5" />
                  View Backup Materials (Page {motion.backup_page_anchor})
                </a>
              )}
            </div>
          ))}

          <div className="pt-2 border-t border-border/50">
            <a
              href={meeting.agenda_pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Full Agenda PDF
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
