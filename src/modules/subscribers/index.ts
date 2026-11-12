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
  // Published for the daily run sheet (BR-26).
  listDeliveryRoster,
  type DeliveryRoster,
  type SubscriberView,
} from "@/modules/subscribers/application/subscriber-management";

export { rosterSummary, whatsappNumber, deliversOn, HOLDS_SEAT, type RosterSummary } from "@/modules/subscribers/domain/subscriber";
