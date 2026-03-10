import { useMeetings } from "@/hooks/use-meetings";
import { useSyncAgendas } from "@/hooks/use-sync-agendas";
import { MotionCard } from "@/components/MotionCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDays, History, Landmark, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import type { MeetingWithMotions, BoardMotion } from "@/lib/types";
import { format } from "date-fns";
import { useMemo } from "react";

export interface MotionCardData {
  motion: BoardMotion;
  meeting: MeetingWithMotions;
}

function getMotionCards(
  meetings: MeetingWithMotions[],
  type: "next" | "past"
): MotionCardData[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let filtered: MeetingWithMotions[];

  if (type === "next") {
    const upcoming = meetings.filter(
      (m) => new Date(m.meeting_date + "T00:00:00") >= today
    );
    if (upcoming.length === 0) return [];
    const nextDate = upcoming.reduce((min, m) =>
      m.meeting_date < min ? m.meeting_date : min
    , upcoming[0].meeting_date);
    filtered = upcoming.filter((m) => m.meeting_date === nextDate);
  } else {
    filtered = meetings.filter(
      (m) => new Date(m.meeting_date + "T00:00:00") < today
    );
  }

  // Only include meetings with motions, flatten to one card per motion
  return filtered
    .filter((m) => m.board_motions.length > 0)
    .flatMap((m) => m.board_motions.map((motion) => ({ motion, meeting: m })));
}

export default function Index() {
  const { data: meetings, isLoading, error } = useMeetings();

  // Only pass meetings that have no motions yet to the auto-syncer
  const pendingMeetings = useMemo(
    () => meetings?.filter((m) => m.board_motions.length === 0),
    [meetings]
  );

  const syncStatus = useSyncAgendas(pendingMeetings);

  const nextCards = meetings ? getMotionCards(meetings, "next") : [];
  const pastCards = meetings ? getMotionCards(meetings, "past") : [];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-primary text-primary-foreground">
        <div className="container max-w-4xl py-6 px-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Landmark className="h-5 w-5 opacity-80" />
                <p className="text-xs font-medium uppercase tracking-widest opacity-70">
                  LA County CEO
                </p>
              </div>
              <h1 className="font-heading text-xl md:text-2xl font-bold tracking-tight">
                Board Motion Tracker
              </h1>
              <p className="text-xs text-primary-foreground/70 max-w-xl mt-0.5">
                Tracking board motion items from cluster meeting agendas.
              </p>
            </div>

            {/* Status indicator */}
            <div className="shrink-0 mt-1">
              {syncStatus.state === "syncing" && (
                <div className="flex items-center gap-1 text-[10px] text-primary-foreground/70">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Updating…</span>
                </div>
              )}
              {syncStatus.state === "success" && syncStatus.lastUpdated && (
                <div className="flex items-center gap-1 text-[10px] text-green-300">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>Updated {format(new Date(syncStatus.lastUpdated), "MMM d, h:mm a")}</span>
                </div>
              )}
              {syncStatus.state === "error" && (
                <div className="flex items-center gap-1 text-[10px] text-red-300">
                  <AlertCircle className="h-3 w-3" />
                  <span>{syncStatus.errorMessage || "Sync failed"}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="container max-w-4xl py-4 px-4">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 p-4 text-center text-sm text-destructive">
            Failed to load meetings. Please try again.
          </div>
        )}

        {!isLoading && !error && (
          <Tabs defaultValue="next" className="w-full">
            <TabsList className="mb-4 bg-muted h-8">
              <TabsTrigger value="next" className="gap-1.5 text-xs h-7">
                <CalendarDays className="h-3 w-3" />
                Next meeting
              </TabsTrigger>
              <TabsTrigger value="past" className="gap-1.5 text-xs h-7">
                <History className="h-3 w-3" />
                Past meetings
              </TabsTrigger>
            </TabsList>

            <TabsContent value="next">
              {nextCards.length === 0 ? (
                <EmptyState message="No upcoming meetings with board motion items." />
              ) : (
                <div className="space-y-2">
                  {nextCards.map((c) => (
                    <MotionCard key={c.motion.id} motion={c.motion} meeting={c.meeting} />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="past">
              {pastCards.length === 0 ? (
                <EmptyState message="No past meetings yet." />
              ) : (
                <div className="space-y-2">
                  {pastCards.map((c) => (
                    <MotionCard key={c.motion.id} motion={c.motion} meeting={c.meeting} />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-4">
        <div className="container max-w-4xl text-center text-xs text-muted-foreground px-4">
          Data sourced from{" "}
          <a
            href="https://ceo.lacounty.gov/agendas/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            ceo.lacounty.gov/agendas
          </a>
        </div>
      </footer>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md border-2 border-dashed border-border py-10 text-center">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
