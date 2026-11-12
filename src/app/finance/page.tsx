import { AppShell } from "@/components/app-shell";
import { FinanceDashboard } from "@/components/finance/finance-dashboard";
import { getMonthView, kitchenDate } from "@/modules/finance";
import { monthSchema } from "@/shared/schemas/finance";

export const dynamic = "force-dynamic";

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const params = await searchParams;
  const parsed = monthSchema.safeParse(params.month);
  const month = parsed.success ? parsed.data : kitchenDate(new Date()).slice(0, 7);

  return (
    <AppShell>
      <FinanceDashboard initialView={await getMonthView(month)} today={kitchenDate(new Date())} />
    </AppShell>
  );
}
