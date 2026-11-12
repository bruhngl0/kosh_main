import { AppShell } from "@/components/app-shell";
import { SubscribersDashboard } from "@/components/subscribers/subscribers-dashboard";
import { listSubscribers, listSubscriptionPlans } from "@/modules/subscribers";

export const dynamic = "force-dynamic";

export default async function SubscribersPage() {
  const [roster, plans] = await Promise.all([listSubscribers(), listSubscriptionPlans()]);
  return (
    <AppShell>
      <SubscribersDashboard initialRoster={roster} plans={plans} />
    </AppShell>
  );
}
