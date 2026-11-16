import { useMeetings, useTrackerStatus } from "@/hooks/use-meetings";
import { MotionCard } from "@/components/MotionCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { CalendarDays, History, Landmark, BarChart3, Search, X } from "lucide-react";
import type { MeetingWithMotions, BoardMotion, BoardStatus, ClusterType } from "@/lib/types";
import { BOARD_STATUS_LABELS, CLUSTER_LABELS, CLUSTER_COLORS } from "@/lib/types";
import { format } from "date-fns";
import { useMemo, useState } from "react";

export interface MotionCardData {
  motion: BoardMotion;
  meeting: MeetingWithMotions;
}

const DISTRICTS = ["1", "2", "3", "4", "5"];

/** Read the supervisorial districts from the start of a motion title, for example "SD-2" or "SD3 & SD4". */
function getDistricts(title: string): string[] {
  const start = title.split(/[“":•]/)[0].slice(0, 40);
  const found = [...start.matchAll(/SD[\s-]?([1-5])/gi)].map((m) => m[1]);
  return [...new Set(found)];
}

/** True if the Board agenda shows a revision, a different title, or a different date. */
function isChanged(motion: BoardMotion): boolean {
  const b = motion.board;
  return Boolean(b.revised_after_cluster || b.title_changed || b.date_changed);
}

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function meetingDay(m: MeetingWithMotions): Date {
  return new Date(m.meeting_date + "T00:00:00");
}

function toCards(meetings: MeetingWithMotions[]): MotionCardData[] {
  return meetings.flatMap((m) =>
    [...m.board_motions]
      .map((motion) => ({ motion, meeting: m }))
  );
}

export default function Index() {
  const { data: meetings, isLoading, error } = useMeetings();
  const [query, setQuery] = useState("");
  const [cluster, setCluster] = useState<ClusterType | "">("");
  const [district, setDistrict] = useState("");
  const [boardFilter, setBoardFilter] = useState<BoardStatus | "changed" | "">("");
  const { data: trackerStatus } = useTrackerStatus();

  const today = startOfToday();
  const upcoming = (meetings || []).filter((m) => meetingDay(m) >= today);
  const nextDate = upcoming.length
    ? upcoming.reduce((min, m) => (m.meeting_date < min ? m.meeting_date : min), upcoming[0].meeting_date)
    : null;

  const matches = (c: MotionCardData) => {
    if (cluster && c.meeting.cluster !== cluster) return false;
    if (district && !getDistricts(c.motion.title).includes(district)) return false;
    if (boardFilter === "changed" && !isChanged(c.motion)) return false;
    if (boardFilter && boardFilter !== "changed" && c.motion.board.status !== boardFilter) return false;
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return true;
    const text = [
      c.motion.title,
      c.motion.summary,
      c.motion.backup_text,
      c.motion.board.board_title,
      c.motion.board.file_number,
      c.motion.item_number,
      CLUSTER_LABELS[c.meeting.cluster],
      format(meetingDay(c.meeting), "MMMM d, yyyy"),
    ]
      .join(" ")
      .toLowerCase();
    return words.every((w) => text.includes(w));
  };

  const allCards = useMemo(() => toCards(meetings || []), [meetings]);
  const shownCards = allCards.filter(matches);
  const nextCards = shownCards.filter((c) => c.meeting.meeting_date === nextDate);
  const pastCards = shownCards.filter((c) => meetingDay(c.meeting) < today);
  const filtersOn = Boolean(query || cluster || district || boardFilter);

  const lastUpdate = trackerStatus?.last_run || null;

  const selectClass =
    "h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

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
            {lastUpdate && (
              <p className="shrink-0 mt-1 text-[10px] text-primary-foreground/70">
                Last check: {format(new Date(lastUpdate), "MMM d, yyyy")}
              </p>
            )}
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
          <>
            {/* Search and filters */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[12rem]">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search titles, summaries, and motion text"
                  aria-label="Search motions"
                  className="h-9 pl-8 text-xs"
                />
              </div>
              <select
                value={cluster}
                onChange={(e) => setCluster(e.target.value as ClusterType | "")}
                aria-label="Filter by cluster"
                className={selectClass}
              >
                <option value="">All clusters</option>
                {(Object.keys(CLUSTER_LABELS) as ClusterType[]).map((c) => (
                  <option key={c} value={c}>
                    {CLUSTER_LABELS[c]}
                  </option>
                ))}
              </select>
              <select
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                aria-label="Filter by supervisorial district"
                className={selectClass}
              >
                <option value="">All districts</option>
                {DISTRICTS.map((d) => (
                  <option key={d} value={d}>
                    District {d}
                  </option>
                ))}
              </select>
              <select
                value={boardFilter}
                onChange={(e) => setBoardFilter(e.target.value as BoardStatus | "changed" | "")}
                aria-label="Filter by Board agenda status"
                className={selectClass}
              >
                <option value="">All Board results</option>
                <option value="on_board_agenda">{BOARD_STATUS_LABELS.on_board_agenda}</option>
                <option value="changed">Changed after cluster</option>
                <option value="waiting">{BOARD_STATUS_LABELS.waiting}</option>
                <option value="not_found">{BOARD_STATUS_LABELS.not_found}</option>
              </select>
              {filtersOn && (
                <button
                  onClick={() => {
                    setQuery("");
                    setCluster("");
                    setDistrict("");
                    setBoardFilter("");
                  }}
                  className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              )}
            </div>

            <Tabs defaultValue="next" className="w-full">
              <TabsList className="mb-4 bg-muted h-8">
                <TabsTrigger value="next" className="gap-1.5 text-xs h-7">
                  <CalendarDays className="h-3 w-3" />
                  Next meeting ({nextCards.length})
                </TabsTrigger>
                <TabsTrigger value="past" className="gap-1.5 text-xs h-7">
                  <History className="h-3 w-3" />
                  Past meetings ({pastCards.length})
                </TabsTrigger>
                <TabsTrigger value="analysis" className="gap-1.5 text-xs h-7">
                  <BarChart3 className="h-3 w-3" />
                  Analysis
                </TabsTrigger>
              </TabsList>

              <TabsContent value="next">
                {nextDate && (
                  <p className="mb-2 text-xs text-muted-foreground">
                    Next meeting date: {format(new Date(nextDate + "T00:00:00"), "EEEE, MMMM d, yyyy")}
                  </p>
                )}
                {nextCards.length === 0 ? (
                  <EmptyState
                    message={
                      filtersOn
                        ? "No board motion items for the next meeting agree with the search."
                        : nextDate
                          ? "The agendas for the next meeting have no board motion items."
                          : "No agendas are available for future meetings."
                    }
                  />
                ) : (
                  <CardList cards={nextCards} />
                )}
              </TabsContent>

              <TabsContent value="past">
                {pastCards.length === 0 ? (
                  <EmptyState
                    message={filtersOn ? "No past board motion items agree with the search." : "No past meetings yet."}
                  />
                ) : (
                  <CardList cards={pastCards} />
                )}
              </TabsContent>

              <TabsContent value="analysis">
                <Analysis cards={shownCards} meetings={meetings || []} cluster={cluster} filtersOn={filtersOn} />
              </TabsContent>
            </Tabs>
          </>
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

function CardList({ cards }: { cards: MotionCardData[] }) {
  return (
    <div className="space-y-2">
      {cards.map((c) => (
        <MotionCard key={c.motion.id} motion={c.motion} meeting={c.meeting} />
      ))}
    </div>
  );
}

function Analysis({
  cards,
  meetings,
  cluster,
  filtersOn,
}: {
  cards: MotionCardData[];
  meetings: MeetingWithMotions[];
  cluster: ClusterType | "";
  filtersOn: boolean;
}) {
  const scope = cluster ? meetings.filter((m) => m.cluster === cluster) : meetings;
  const held = scope.filter((m) => !m.is_cancelled);
  const withMotions = new Set(cards.map((c) => c.meeting.id)).size;

  const byCluster = (Object.keys(CLUSTER_LABELS) as ClusterType[]).map((c) => ({
    label: CLUSTER_LABELS[c],
    color: CLUSTER_COLORS[c],
    count: cards.filter((x) => x.meeting.cluster === c).length,
  }));
  const byDistrict = DISTRICTS.map((d) => ({
    label: `District ${d}`,
    color: "bg-primary",
    count: cards.filter((x) => getDistricts(x.motion.title).includes(d)).length,
  }));
  const compared = cards.filter((c) => c.motion.board.status === "on_board_agenda" || c.motion.board.status === "not_found");
  const onBoard = compared.filter((c) => c.motion.board.status === "on_board_agenda");
  const boardRows = [
    { label: "On a Board agenda", color: "bg-emerald-600", count: onBoard.length },
    { label: "Not found", color: "bg-destructive", count: compared.length - onBoard.length },
    { label: "Revised after cluster", color: "bg-amber-500", count: onBoard.filter((c) => c.motion.board.revised_after_cluster).length },
    { label: "Different title", color: "bg-amber-500", count: onBoard.filter((c) => c.motion.board.title_changed).length },
    { label: "Different Board date", color: "bg-amber-500", count: onBoard.filter((c) => c.motion.board.date_changed).length },
  ];
  const waiting = cards.filter((c) => c.motion.board.status === "waiting").length;
  const noData = cards.filter((c) => c.motion.board.status === "no_board_data").length;
  const months = [...new Set(cards.map((c) => c.meeting.meeting_date.slice(0, 7)))].sort();
  const byMonth = months.map((m) => ({
    label: format(new Date(m + "-01T00:00:00"), "MMM yyyy"),
    color: "bg-primary",
    count: cards.filter((x) => x.meeting.meeting_date.startsWith(m)).length,
  }));

  return (
    <div className="space-y-4">
      {filtersOn && (
        <p className="text-xs text-muted-foreground">The numbers show only the motions that agree with the search.</p>
      )}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Board motion items" value={cards.length} />
        <Stat label="Meetings with motions" value={withMotions} />
        <Stat label="Meetings held" value={held.length} />
        <Stat label="Meetings cancelled" value={scope.length - held.length} />
      </div>
      <BarGroup
        title={`Cluster motions on Board agendas (${compared.length} motions compared)`}
        rows={boardRows}
        note={`${waiting} motions are too recent to compare. ${noData} motions are from a period without Board agenda data.`}
      />
      <BarGroup title="Motions by cluster" rows={byCluster} />
      <BarGroup title="Motions by supervisorial district" rows={byDistrict} note="A motion with two authors counts for each district." />
      <BarGroup title="Motions by month" rows={byMonth} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function BarGroup({
  title,
  rows,
  note,
}: {
  title: string;
  rows: { label: string; color: string; count: number }[];
  note?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="rounded-md border border-border bg-card p-3">
      <h2 className="mb-2 text-xs font-semibold text-foreground">{title}</h2>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">No data.</p>}
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-xs">
            <span className="w-36 shrink-0 text-muted-foreground">{r.label}</span>
            <div className="h-3 flex-1 rounded bg-muted">
              <div className={`h-3 rounded ${r.color}`} style={{ width: `${(r.count / max) * 100}%` }} />
            </div>
            <span className="w-6 shrink-0 text-right font-medium text-foreground">{r.count}</span>
          </div>
        ))}
      </div>
      {note && <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>}
    </section>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md border-2 border-dashed border-border py-10 text-center">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
