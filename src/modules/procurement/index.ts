/** Procurement module — public surface. See docs/system-design.md §4.3. */

export { generatePurchaseOrders } from "@/modules/procurement/application/generate-purchase-orders";

export {
  receivePurchaseOrder,
  transitionPurchaseOrder,
} from "@/modules/procurement/application/receive-purchase-order";

export {
  listPurchaseOrders,
  getPurchaseOrder,
  getOutreach,
  toPurchaseOrderView,
  listReceivedOrderCosts,
} from "@/modules/procurement/application/purchase-order-queries";

export { createPurchaseOrder } from "@/modules/procurement/application/create-purchase-order";

export { getCostSummary } from "@/modules/procurement/application/cost-summary";

export {
  aggregateDemand,
  buildPurchasePlan,
  type DemandLine,
  type IngredientContext,
  type PurchasePlan,
  type UnitException,
} from "@/modules/procurement/domain/demand";

export {
  allowedTransitions,
  canTransition,
  isTerminal,
  isRegenerable,
  planReceipt,
  type PurchaseOrderStatus,
} from "@/modules/procurement/domain/lifecycle";

export {
  buildOutreachMessage,
  whatsappLink,
  type OutreachMessage,
} from "@/modules/procurement/domain/outreach";

export {
  calculateFoodCost,
  blendedDailyRate,
  totalSubscribers,
  formatInr,
  type FoodCostBreakdown,
  type PlanEnrolment,
} from "@/modules/procurement/domain/food-cost";
