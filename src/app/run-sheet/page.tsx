import { AppShell } from "@/components/app-shell";
import { RunSheet } from "@/components/run-sheet/run-sheet";
import { kitchenDate } from "@/modules/finance";
import { getRunSheet } from "@/modules/runsheet";
import { isoDateSchema } from "@/shared/schemas/finance";

export const dynamic = "force-dynamic";

export default async function RunSheetPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const params = await searchParams;
  const today = kitchenDate(new Date());
  const parsed = isoDateSchema.safeParse(params.date);
  const date = parsed.success ? parsed.data : today;

  return (
    <AppShell>
      {/* Keyed on the date so moving between days starts from fresh state. */}
      <RunSheet key={date} initialSheet={await getRunSheet(date)} today={today} />
    </AppShell>
  );
}
