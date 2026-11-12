import type { SubscriberStatus } from "@/shared/schemas/subscribers";

export type Plan = { id: string; name: string; dailyRate: number };

export const STATUS_LABELS: Record<SubscriberStatus, string> = {
  onboarding: "Onboarding",
  active: "Active",
  paused: "Paused",
  ended: "Ended",
};
