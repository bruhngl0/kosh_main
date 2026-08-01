/** Shared view types for the inventory screens, mirroring the API read models. */

export type Ingredient = {
  id: string;
  name: string;
  category: string;
  defaultUnit: string;
  defaultFrequency: string;
  inventoryStatus: string;
  quantityNeeded: number;
  notes: string | null;
  quantity: number;
  parLevel: number;
  reorderPoint: number;
  parStatus: "out-of-stock" | "below-par" | "ok";
  reorderQuantity: number;
  unitCost: number | null;
  purchaseUnit: string | null;
  vendor: { id: string; name: string } | null;
  standingLineCost: number | null;
};

export type Vendor = {
  id: string;
  name: string;
  category: string | null;
  contact: string | null;
  whatsapp: string | null;
  phone: string | null;
  email: string | null;
  minimumOrder: string | null;
  leadTime: string | null;
  cutoff: string | null;
  area: string | null;
  paymentTerms: string | null;
  notes: string | null;
  whatsappUrl: string | null;
  counts: { ingredients: number; purchaseOrders: number };
};

export type VesselKit = {
  id: string;
  subscriberName: string;
  type: string;
  typeLabel: string;
  status: string;
  sets: number;
  issuedAt: string | null;
  sanitisedAt: string | null;
  daysSinceSanitised: number | null;
  sanitisationOverdue: boolean;
  notes: string | null;
};

export type PurchaseOrder = {
  id: string;
  status: string;
  weekNumber: number | null;
  allowedTransitions: string[];
  vendor: { id: string; name: string; contact: string | null; whatsapp: string | null; leadTime: string | null };
  lines: {
    id: string;
    ingredientId: string;
    ingredientName: string;
    requestedQty: number;
    receivedQty: number;
    outstandingQty: number;
    unit: string;
    unitCost: number | null;
    lineCost: number | null;
  }[];
  lineCount: number;
  estimatedCost: number;
};

export type Outreach = {
  purchaseOrderId: string;
  message: string;
  whatsappUrl: string | null;
  lineCount: number;
};

export type CostSummary = {
  basis: string;
  totalSpend: number;
  totalRevenue: number;
  subscriberCount: number;
  foodCostPercent: number;
  targetPercent: number;
  withinTarget: boolean;
  costPerSubscriber: number;
  costPerMeal: number;
  ingredientMargin: number;
  byCategory: { key: string; cost: number; share: number }[];
  byVendor: { key: string; cost: number; share: number }[];
  byFrequency: { key: string; cost: number; share: number }[];
  enrolments: { planName: string; dailyRate: number; subscriberCount: number }[];
};

export type GenerationResult = {
  orders: PurchaseOrder[];
  unsourced: { ingredientId: string; ingredientName: string; requestedQty: number; unit: string }[];
  exceptions: { ingredientName: string; from: string; to: string; quantity: number }[];
  skipped: { vendorName: string; status: string }[];
};

export const CATEGORIES: [string, string][] = [
  ["all", "All"],
  ["protein", "Proteins & Fish"],
  ["produce", "Produce & Herbs"],
  ["grains", "Grains & Legumes"],
  ["dairy", "Dairy & Eggs"],
  ["specialty", "Specialty / Imported"],
  ["pantry", "Pantry & Dry Goods"],
  ["oils", "Oils & Condiments"],
  ["vessel", "Vessel & Ops"],
];

export const FREQUENCIES: [string, string][] = [
  ["", "All frequencies"],
  ["daily", "Daily order"],
  ["weekly", "Weekly order"],
  ["monthly", "Monthly stock"],
  ["adhoc", "Ad hoc"],
];

export const STATUSES: [string, string][] = [
  ["needed", "Needed"],
  ["ordered", "Ordered"],
  ["received", "Received"],
  ["cancelled", "Cancelled"],
];

export const categoryLabel = (id: string) =>
  CATEGORIES.find(([key]) => key === id)?.[1] ?? id;

export const inr = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
