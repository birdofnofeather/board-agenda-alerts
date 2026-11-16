import { useState } from "react";
import { ChevronDown, FileText, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import type { MeetingWithMotions, BoardMotion } from "@/lib/types";
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
  motion: BoardMotion;
  meeting: MeetingWithMotions;
}

function toSentenceCase(str: string): string {
  if (!str) return str;
  if (str === str.toUpperCase() || (str.replace(/[^A-Z]/g, '').length / str.replace(/\s/g, '').length) > 0.7) {
    const lower = str.toLowerCase();
    // Keep the district label, for example "SD3", and start the subject with a capital letter.
    return (lower.charAt(0).toUpperCase() + lower.slice(1))
      .replace(/\bsd[\s-]?([1-5])\b/gi, "SD$1")
      .replace(/^((?:SD\d[\s,&and]*)+\s*[-–:]\s*)([a-z])/, (_, label, first) => label + first.toUpperCase());
  }
  return str;
}

export function MotionCard({ motion, meeting }: MotionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const meetingDate = new Date(meeting.meeting_date + "T00:00:00");

  return (
    <div
      className={cn(
        "bg-card rounded-md border border-border shadow-sm overflow-hidden transition-all duration-200 hover:shadow-md",
        "border-l-[3px]",
        clusterBorderColors[meeting.cluster]
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-2.5 flex items-start justify-between gap-2"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span
              className={cn(
                "text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide",
                clusterBadgeBg[meeting.cluster]
              )}
            >
              {CLUSTER_LABELS[meeting.cluster]}
            </span>
            {motion.item_number && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wide">
                Item {motion.item_number}
              </span>
            )}
            {meeting.revisions > 0 && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wide">
                Agenda revised
              </span>
            )}
            {meeting.is_cancelled && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive uppercase tracking-wide">
                Cancelled
              </span>
            )}
          </div>

          <h3 className="text-sm font-medium text-foreground leading-snug">
            {toSentenceCase(motion.title)}
          </h3>

          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span>
              {format(meetingDate, "MMM d, yyyy")}
              {meeting.meeting_time && ` · ${meeting.meeting_time}`}
            </span>
            {meeting.teams_link && (
              <a
                href={meeting.teams_link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-primary hover:underline"
              >
                Join meeting
              </a>
            )}
          </div>
        </div>

        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 mt-0.5",
            expanded && "rotate-180"
          )}
        />
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-border/50 pt-2.5 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
          {motion.summary && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {motion.summary}
            </p>
          )}
          {motion.backup_page_anchor && (
            <a
              href={`${meeting.agenda_pdf_url}#page=${motion.backup_page_anchor}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
            >
              <FileText className="h-3 w-3" />
              Backup materials (p. {motion.backup_page_anchor})
            </a>
          )}

          <div className="pt-1.5 border-t border-border/50">
            <a
              href={meeting.agenda_pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
            >
              <ExternalLink className="h-3 w-3" />
              Full agenda PDF
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
