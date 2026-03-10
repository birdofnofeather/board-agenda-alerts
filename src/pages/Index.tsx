import { useMeetings } from "@/hooks/use-meetings";
import { useSyncAgendas } from "@/hooks/use-sync-agendas";
import { MotionCard } from "@/components/MotionCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDays, History, Landmark, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MeetingWithMotions } from "@/lib/types";
import { format } from "date-fns";

function filterMeetings(
  meetings: MeetingWithMotions[],
  type: "next" | "past"
): MeetingWithMotions[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (type === "next") {
    const upcoming = meetings.filter(
      (m) => new Date(m.meeting_date + "T00:00:00") >= today
    );
    if (upcoming.length === 0) return [];
    const nextDate = upcoming.reduce((min, m) =>
      m.meeting_date < min ? m.meeting_date : min
    , upcoming[0].meeting_date);
    return upcoming.filter((m) => m.meeting_date === nextDate);
  }

  return meetings.filter(
    (m) => new Date(m.meeting_date + "T00:00:00") < today
  );
}

function getLastUpdated(meetings: MeetingWithMotions[]): string | null {
  const allDates = meetings.flatMap((m) => [
    m.updated_at,
    ...m.board_motions.map((b) => b.updated_at),
  ]);
  if (allDates.length === 0) return null;
  const latest = allDates.reduce((a, b) => (a > b ? a : b));
  return format(new Date(latest), "MMM d, yyyy 'at' h:mm a");
}

export default function Index() {
  const { data: meetings, isLoading, error } = useMeetings();
  const { sync, isSyncing, progress } = useSyncAgendas();

  const nextMeetings = meetings ? filterMeetings(meetings, "next") : [];
  const pastMeetings = meetings ? filterMeetings(meetings, "past") : [];
  const lastUpdated = meetings ? getLastUpdated(meetings) : null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-primary text-primary-foreground">
        <div className="container max-w-4xl py-6 px-4">
          <div className="flex items-center gap-2 mb-1">
            <Landmark className="h-5 w-5 opacity-80" />
            <p className="text-xs font-medium uppercase tracking-widest opacity-70">
              LA County CEO
            </p>
          </div>
          <h1 className="font-heading text-xl md:text-2xl font-bold tracking-tight">
            Board Motion Tracker
          </h1>
          <div className="flex items-start justify-between gap-3 mt-1">
            <div>
              <p className="text-xs text-primary-foreground/70 max-w-xl">
                Tracking board motion items from cluster meeting agendas.
              </p>
              {lastUpdated && (
                <p className="text-[10px] text-primary-foreground/50 mt-0.5">
                  Last updated: {lastUpdated}
                </p>
              )}
            </div>
            {(() => {
              const missing = meetings?.filter((m) => m.board_motions.length === 0) || [];
              return (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => sync(missing)}
                  disabled={isSyncing || missing.length === 0}
                  className="shrink-0 text-xs h-7 px-2"
                >
                  <RefreshCw className={`h-3 w-3 mr-1 ${isSyncing ? "animate-spin" : ""}`} />
                  {isSyncing ? "Syncing…" : missing.length > 0 ? `Sync ${missing.length}` : "All synced"}
                </Button>
              );
            })()}
          </div>
          {progress && (
            <p className="mt-1 text-[10px] text-primary-foreground/60">{progress}</p>
          )}
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
              {nextMeetings.length === 0 ? (
                <EmptyState message="No upcoming meetings with board motion items." />
              ) : (
                <div className="space-y-2">
                  {nextMeetings.map((m) => (
                    <MotionCard key={m.id} meeting={m} />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="past">
              {pastMeetings.length === 0 ? (
                <EmptyState message="No past meetings yet." />
              ) : (
                <div className="space-y-2">
                  {pastMeetings.map((m) => (
                    <MotionCard key={m.id} meeting={m} />
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
