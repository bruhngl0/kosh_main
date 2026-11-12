/** Vessels module — public surface. See docs/system-design.md §4.3. */

export {
  createVesselKit,
  updateVesselKit,
  listVesselKits,
  getVesselSummary,
  // Published for the daily run sheet (BR-28).
  kitsForSubscribers,
  recordSanitised,
} from "@/modules/vessels/application/vessel-management";
