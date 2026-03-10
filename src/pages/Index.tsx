import { useMeetings } from "@/hooks/use-meetings";
import { MotionCard } from "@/components/MotionCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDays, History, Landmark } from "lucide-react";
import type { MeetingWithMotions } from "@/lib/types";

function filterMeetings(
  meetings: MeetingWithMotions[],
  type: "next" | "past"
): MeetingWithMotions[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const withMotions = meetings.filter((m) => m.board_motions.length > 0);

  if (type === "next") {
    // Find the next meeting date (>= today)
    const upcoming = withMotions.filter(
      (m) => new Date(m.meeting_date + "T00:00:00") >= today
    );
    if (upcoming.length === 0) return [];
    // Get the earliest upcoming date
    const nextDate = upcoming.reduce((min, m) =>
      m.meeting_date < min ? m.meeting_date : min
    , upcoming[0].meeting_date);
    return upcoming.filter((m) => m.meeting_date === nextDate);
  }

  // Past: all meetings with motions before today
  return withMotions.filter(
    (m) => new Date(m.meeting_date + "T00:00:00") < today
  );
}

export default function Index() {
  const { data: meetings, isLoading, error } = useMeetings();

  const nextMeetings = meetings ? filterMeetings(meetings, "next") : [];
  const pastMeetings = meetings ? filterMeetings(meetings, "past") : [];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-primary text-primary-foreground">
        <div className="container max-w-4xl py-10">
          <div className="flex items-center gap-3 mb-2">
            <Landmark className="h-7 w-7 opacity-80" />
            <p className="text-sm font-medium uppercase tracking-widest opacity-70">
              LA County CEO
            </p>
          </div>
          <h1 className="font-heading text-3xl md:text-4xl font-bold tracking-tight">
            Board Motion Tracker
          </h1>
          <p className="mt-2 text-primary-foreground/70 max-w-xl">
            Tracking Board Motion Items from cluster meeting agendas. Cards
            appear only when a meeting agenda contains one or more Board Motion
            Items.
          </p>
        </div>
      </header>

      {/* Content */}
      <main className="container max-w-4xl py-8">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-destructive/10 p-6 text-center text-destructive">
            Failed to load meetings. Please try again.
          </div>
        )}

        {!isLoading && !error && (
          <Tabs defaultValue="next" className="w-full">
            <TabsList className="mb-6 bg-muted">
              <TabsTrigger value="next" className="gap-2">
                <CalendarDays className="h-4 w-4" />
                Next Meeting
              </TabsTrigger>
              <TabsTrigger value="past" className="gap-2">
                <History className="h-4 w-4" />
                Past Meetings
              </TabsTrigger>
            </TabsList>

            <TabsContent value="next">
              {nextMeetings.length === 0 ? (
                <EmptyState message="No upcoming meetings with Board Motion Items." />
              ) : (
                <div className="space-y-4">
                  {nextMeetings.map((m) => (
                    <MotionCard key={m.id} meeting={m} />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="past">
              {pastMeetings.length === 0 ? (
                <EmptyState message="No past meetings with Board Motion Items yet." />
              ) : (
                <div className="space-y-4">
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
      <footer className="border-t border-border py-6">
        <div className="container max-w-4xl text-center text-sm text-muted-foreground">
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
    <div className="rounded-lg border-2 border-dashed border-border py-16 text-center">
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}
