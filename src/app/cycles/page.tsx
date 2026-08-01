import { AppShell } from "@/components/app-shell";
import { CyclePlanner } from "@/components/cycles/cycle-planner";
import { getCycleCalendar, listCycles } from "@/modules/cycles";
import { listPrepTasks } from "@/modules/production";
import { listAssignableVersions } from "@/modules/recipes";

export const dynamic = "force-dynamic";

export default async function CyclesPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>;
}) {
  const params = await searchParams;
  const [calendar, cycles, recipeOptions] = await Promise.all([
    getCycleCalendar(params.cycle),
    listCycles(),
    listAssignableVersions(),
  ]);

  if (!calendar) {
    return (
      <AppShell>
        <main className="empty-state">
          <h1>No cycle found</h1>
          <p>Run <code>npm run db:seed</code> to create Cycle 01, or create one from the planner.</p>
        </main>
      </AppShell>
    );
  }

  const prepTasks = await listPrepTasks(calendar.cycle.id);

  return (
    <AppShell>
      <CyclePlanner
        cycle={calendar.cycle}
        cycles={cycles.map((cycle) => ({
          id: cycle.id,
          name: cycle.name,
          cycleNumber: cycle.cycleNumber,
          status: cycle.status,
        }))}
        days={calendar.days}
        conflicts={calendar.conflicts}
        stats={calendar.stats}
        prepTasks={prepTasks}
        recipeOptions={recipeOptions}
      />
    </AppShell>
  );
}
