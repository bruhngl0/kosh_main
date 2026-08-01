import { AppShell } from "@/components/app-shell";
import { InventoryDashboard } from "@/components/inventory/inventory-dashboard";
import { listIngredients } from "@/modules/inventory";
import { listVendors } from "@/modules/vendors";
import { listVesselKits } from "@/modules/vessels";
import { listCycles, weekCountFor } from "@/modules/cycles";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const [ingredients, vendors, kits, cycles] = await Promise.all([
    listIngredients({ managedOnly: true }),
    listVendors(),
    listVesselKits(),
    listCycles(),
  ]);

  const latest = cycles[0] ?? null;

  return (
    <AppShell>
      <InventoryDashboard
        initialIngredients={ingredients}
        initialVendors={vendors}
        initialKits={kits}
        cycle={
          latest
            ? {
                id: latest.id,
                name: latest.name,
                subscriberCount: latest.subscriberCount,
                weekCount: weekCountFor(latest.durationDays),
                chefName: latest.chefName,
                foodCostTargetPercent: latest.foodCostTargetPercent,
              }
            : null
        }
      />
    </AppShell>
  );
}
