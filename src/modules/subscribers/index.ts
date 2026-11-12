/** Subscribers module — public surface. See docs/system-design.md §4.3 and BR-23..BR-25. */

export {
  listSubscribers,
  getSubscriber,
  listSubscriptionPlans,
  getRosterSummary,
  createSubscriber,
  updateSubscriber,
  syncFromOnboarding,
  subscriberCapacity,
  type SubscriberView,
} from "@/modules/subscribers/application/subscriber-management";

export { rosterSummary, whatsappNumber, HOLDS_SEAT, type RosterSummary } from "@/modules/subscribers/domain/subscriber";
