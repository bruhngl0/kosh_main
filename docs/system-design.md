# Kōsh Operations Platform — System Design

**Version:** 1.0
**Status:** Authoritative. This document is the contract; code that disagrees with it is a bug in one of the two.
**Deployment target:** Vercel (Next.js) + Neon PostgreSQL. Local development uses Docker PostgreSQL against the same migrations.

---

## 1. What Kōsh is

Kōsh is a private subscription kitchen in Sadashivnagar, Bengaluru. It cooks and delivers every meal, every morning, to a fixed roster of household subscribers. There is no storefront and no walk-in service. The entire business is a repeating loop:

> plan a menu cycle → derive the work → buy the ingredients → cook → deliver in reusable vessels → repeat

This platform is the internal operating system for that loop. It is used by the chef, the kitchen team, and whoever is doing procurement that week. It is not customer-facing.

The three HTML prototypes in the repository root are the product specification written by the people who actually run the kitchen. They encode real operational knowledge — the four-day protein rotation rule, the 24-hour salmon marinade, the "makhana must be fully cool before it goes in the vessel or it goes soft" note. **The prototypes are the requirements. This system must not lose behaviour they already have.** They are retired only after each behaviour has an accepted replacement.

### 1.1 The three prototypes and what each one owns

| Prototype | Owns | Becomes |
| --- | --- | --- |
| `Kosh_Cycle_Planner.html` | The 28-day menu, protein rotation safety, advance-prep lead times, weekly production lists | Cycles + Production modules |
| `Kosh_Recipe_Database.html` | Per-dish execution cards: ingredients with prep notes, method steps with critical controls, allergens, plating | Recipes module |
| `Kosh_Inventory.html` | Ingredient master, vendor directory, par levels, stock, purchasing, vendor outreach, food-cost P&L, vessel kits | Inventory + Procurement + Vendors + Vessels modules |
| `Kosh_Cash_Flow.html` | Cash ledger with running balance, weekly view, charts, fixed-cost reminders, danger flags | Finance module (`/finance`) |

---

## 2. The business, precisely

### 2.1 Vocabulary

- **Cycle** — a named planning period, normally 28 days, divided into four 7-day weeks. Each week has a phase label: *Establish, Expand, Refine, Peak*.
- **Cycle day** — one day of a cycle, holding exactly four **meal slots**: Breakfast (`BF`), Snack (`SN`), Lunch (`LU`), Dinner (`DI`).
- **Recipe** — a reusable dish identity. A **recipe version** is an immutable snapshot of how to cook it: nutrition, ingredients, method steps, allergens, plating notes.
- **Meal assignment** — binds one cycle day + meal slot to one recipe version, with a serving count. It points at a *version*, never at a recipe, so editing a recipe next month cannot silently rewrite what the kitchen cooked last month.
- **Advance-prep task** — work that must happen before the day of service (marinate 24 hours prior, ferment the dosa batter 18 hours, cook the lentil batch Monday morning). Derived from recipe steps, tracked to completion.
- **Ingredient** — the procurement master record. One row per thing the kitchen buys.
- **Vendor** — a supplier. Vendors are linked to the ingredients they supply, with unit cost and a preferred flag.
- **Inventory balance** — current stock on hand for an ingredient, plus its par level and reorder point.
- **Inventory movement** — an immutable record of stock changing. The *only* mechanism that may change a balance.
- **Purchase order** — purchase lines for one vendor, for one cycle week, moving through a lifecycle from draft to received.
- **Subscriber** — a household on the meal plan, on a subscription plan with a daily rate.
- **Vessel kit** — the reusable steel or copper containers issued to a subscriber. Each subscriber normally holds two sets so one is always in circulation while the other is being washed.

### 2.2 The operational week

```
Sunday      Plan the week. Confirm menu, run conflict check, generate advance prep.
Sun/Mon     Generate purchase requirements. Send vendor outreach on WhatsApp.
Mon–Sat     Receive goods at 05:30. Cook. Deliver. Record consumption.
Ongoing     Sanitise and rotate vessel kits. Flag replacements.
```

Two facts about this loop drive most of the design:

1. **Planning state and physical stock state are separate.** Publishing a menu does not consume food. Generating a purchase order does not add food. Only a recorded movement changes stock. This separation is non-negotiable; conflating them is how kitchens end up with inventory numbers nobody trusts.
2. **Everything regenerates.** The chef will re-run prep generation and purchase generation repeatedly as the menu firms up. Every generation command must be idempotent — re-running reconciles, it never duplicates.

---

## 3. Business rules

These are numbered because tests reference them. Each is a pure decision that belongs in a domain function, not in a route handler or a React component.

### BR-1 — Protein rotation
No dinner protein may repeat within a rolling window of **4 days** (configurable per cycle). `plant`, `dairy`, and `legume` are exempt — they are staples, not features.
*Source: `Kosh_Cycle_Planner.html:421`.* Violations are advisory, not blocking: the chef may knowingly override, but a conflict must be surfaced on the calendar, in a dedicated conflicts view, and in the day detail modal.

### BR-2 — Suggested swaps
When flagging a conflict, suggest an alternative protein category: chicken→fish or lamb, fish→chicken or plant, prawn→duck or beef, lamb→prawn or fish, salmon→chicken or plant, beef→fish or pork. Unknown proteins fall back to "a different protein category".
*Source: `Kosh_Cycle_Planner.html:536`.*

### BR-3 — Advance-prep lead classification
Prep requirements carry a lead time inferred from their text, in priority order:

| Contains | Lead type | Due |
| --- | --- | --- |
| `3 days` | `D3` | service date − 3 days |
| `24hr` | `H24` | service date − 1 day |
| `overnight`, `18hr`, `6hr` | `DAY_BEFORE` | service date − 1 day |
| otherwise | `SAME_DAY` | service date |

A task is **urgent** if its text contains `PRIOR`, `mandatory`, or `MANDATORY`, or if its lead type is `H24` or `D3`.
*Source: `Kosh_Cycle_Planner.html:435`.* Due dates are only computable when the cycle has a `weekStart`; without one the task is created with a null due date and sorts last.

### BR-4 — Cycle publish validation
A cycle may become `ACTIVE` only when every cycle day has all four meal slots filled, and every assigned recipe version is `PUBLISHED` and belongs to an active recipe. Failing validation returns the offending days and the cycle stays `DRAFT`.

### BR-5 — Meal slot compatibility
A recipe version may only be assigned to a slot matching its recipe's meal type. A lunch recipe cannot be assigned to the breakfast slot.

### BR-6 — Demand aggregation
```
line demand = recipe ingredient quantity × assignment servings
```
Aggregated per ingredient across the selected week, converted into the ingredient's stock unit (see §6). Servings default to the cycle's subscriber count at assignment time.

### BR-7 — Purchase quantity
```
quantity to order = max(0, demand − stock on hand)
```
Grouped by the ingredient's **preferred** vendor. Ingredients with demand but **no** preferred vendor are not dropped — they are returned as an explicit *unsourced* exception group so procurement can act on them.
*The prototype's per-item `Qty Needed` is a standing reference value, not a substitute for week-specific computed demand. Both are retained; they answer different questions.*

### BR-8 — Par level status
`out of stock` when stock is 0; `below par` when stock < par level; otherwise `ok`. Items below par are the reorder worklist.

### BR-9 — Inventory movement signs
Movement type determines direction. The caller supplies a magnitude, never a sign.

| Type | Effect | Magnitude | Reason required |
| --- | --- | --- | --- |
| `RECEIVE` | increases | > 0 | no |
| `RETURN` | increases | > 0 | no |
| `CONSUME` | decreases | > 0 | no |
| `WASTE` | decreases | > 0 | **yes** |
| `ADJUST` | sets to a counted value | ≥ 0 | **yes** |

### BR-10 — Non-negative stock
A movement may not drive a balance below zero. Attempting it fails with `INSUFFICIENT_STOCK` and reports the shortfall. An explicit authorised override is required to proceed, and the override is recorded on the movement.

### BR-11 — Balance integrity
An inventory balance may only change inside the same transaction that writes its movement. There is no code path that edits a balance directly.

### BR-12 — Purchase order lifecycle
```
DRAFT → OUTREACH_READY → ORDERED → PARTIALLY_RECEIVED → RECEIVED
  └──────────── any non-terminal → CANCELLED ────────────┘
```
`RECEIVED` and `CANCELLED` are terminal. Illegal transitions are rejected with `INVALID_TRANSITION`.

### BR-13 — Receiving creates stock
Recording receipt against purchase order lines writes `RECEIVE` movements for each line, in one transaction. The order becomes `PARTIALLY_RECEIVED` when some lines are short, `RECEIVED` when all lines are fully received. **This is the only bridge between procurement and inventory.**

### BR-14 — Production consumes stock
Executing a production run for a cycle day computes required ingredients from its assignments and writes `CONSUME` movements, subject to BR-10.

### BR-15 — Recipe version immutability
A `PUBLISHED` recipe version is immutable. Changes require a new version. A version referenced by an assignment in a non-draft cycle can never be deleted or archived out from under it.

### BR-16 — Generation idempotency
Prep-task and purchase-order generation reconcile against a stable natural key:
- Prep tasks key on `(cycleId, sourceKey)` where `sourceKey = cycleDayId:mealType:stepNumber`.
- Purchase orders key on `(cycleId, vendorId, weekNumber)`.

Re-running updates matching rows, creates missing ones, and removes rows that are no longer derivable — **while preserving human-entered state**: a completed prep task stays completed, and a purchase order that has left `DRAFT` is never silently rewritten.

### BR-17 — Food cost
```
weekly ingredient spend = Σ (line demand × preferred vendor unit cost)
weekly revenue          = Σ (active subscriber plan daily rate) × production days
food cost %             = weekly ingredient spend / weekly revenue × 100
```
The prototype hardcoded a blended rate derived from a 22/10/5 subscriber mix at ₹2400/₹1800/₹1600 per day (`Kosh_Inventory.html:872`). That mix becomes real `SubscriptionPlan` rows so the P&L reflects the actual roster instead of a frozen constant. Cost per subscriber, cost per meal, and ingredient margin derive from the same two figures.

### BR-18 — Vessel rotation
Each subscriber normally holds 2 sets. Kits are `active`, `needs-replace`, or `retired`. Sanitisation date is tracked; a kit not sanitised within its interval is flagged.

### BR-19 — Cash transactions
Every row has a positive amount (enforced by a `CHECK` constraint) and a direction, `IN` or `OUT`, which carries the sign. Its category must belong to that direction — income: Subscriptions, Kit Deposits, Staples & Air Menu, Other Income; expense: Ingredients, Kitchen Staff, Delivery, Vessels & Packaging, Rent, Utilities, Marketing, Equipment, Compliance, Miscellaneous. An update re-checks the resulting pair, because either field may change alone. Rows are hard-deleted; the audit event keeps the full snapshot.

### BR-20 — Opening balance and danger flags
A month opens at its hand-set balance if one exists, otherwise at the previous month's closing balance, carried through every earlier month. A hand-set month resets the chain from that point — it is how the owner reconciles against the bank. Clearing it resumes carry-forward. Months are calendar months in kitchen-local time (IST); weeks are fixed day ranges 1–7, 8–14, 15–21, 22–28, 29–end. The month is flagged **danger** if the closing balance is negative, or if unpaid fixed costs would make it negative; **warn** if the balance after fixed costs is under ₹1,00,000. Food cost % is month ingredients ÷ month subscription revenue, graded against the latest cycle's target (default 30%): warn above it, danger 5 points over.

### BR-21 — Purchase orders feed the ledger
Fully received purchase orders in the month (by IST receipt date) can be imported as Ingredients expenses, priced on **received** quantity × line unit cost. Lines without a unit cost are excluded and noted on the row, never guessed. `cash_transactions.purchase_order_id` is unique, so re-running the import — or two people clicking at once — cannot double-count. Finance reads orders only through procurement's published `listReceivedOrderCosts`.

### BR-22 — Fixed costs
Recurring monthly costs are reminders, never auto-posted. One counts as paid for a month when an expense was posted from it, or an expense's description contains its name. Posting is refused if that cost is already posted in the month. Fixed costs are deactivated, not deleted.

---

## 4. Architecture

A **modular monolith**: one Next.js application, one PostgreSQL database, strict internal module boundaries. Modules share a process and a database but communicate only through published interfaces — never by importing another module's repository or reaching into its tables.

This is deliberately not microservices. The kitchen is one team with one database; distribution would buy nothing and cost transactions. The module boundaries exist so that the domain rules are testable and so extraction stays *possible*, not because extraction is planned.

### 4.1 Layering

```
┌─ app/api/v1/**/route.ts ──────────────────────────────────┐
│  HTTP adapter. Parse → authorise → call ONE use case →    │
│  map result to the response envelope. No business logic,  │
│  no Prisma, no orchestration.                             │
└───────────────────────────┬───────────────────────────────┘
                            ▼
┌─ modules/<m>/application ──────────────────────────────────┐
│  Use cases. Own transactions and orchestration. Call       │
│  domain functions for decisions and repositories for I/O.  │
│  Emit audit events. Never touch HTTP.                      │
└───────────────────────────┬───────────────────────────────┘
              ┌─────────────┴─────────────┐
              ▼                           ▼
┌─ modules/<m>/domain ────────┐ ┌─ modules/<m>/infrastructure ─┐
│  Pure functions and types.  │ │  Prisma repositories. The     │
│  Zero I/O, zero imports     │ │  only place Prisma is         │
│  from Prisma or Next.       │ │  imported. Maps rows to       │
│  Every business rule in §3  │ │  domain types.                │
│  lives here. 100% testable  │ │                               │
│  with no database.          │ │                               │
└─────────────────────────────┘ └───────────────────────────────┘
```

**The dependency rule:** dependencies point inward. `domain` imports nothing from the other two layers. `application` may import `domain` and `infrastructure`. `app/` may import only a module's `index.ts` barrel.

### 4.2 Directory structure

```
src/
  app/
    (app)/                          # UI routes
      page.tsx                      # dashboard
      cycles/page.tsx
      cycles/[cycleId]/page.tsx
      recipes/page.tsx
      recipes/[recipeId]/page.tsx
      inventory/page.tsx
      procurement/page.tsx
      vessels/page.tsx
    api/v1/**/route.ts              # thin HTTP adapters
  modules/
    cycles/        { domain, application, infrastructure, index.ts }
    recipes/       { domain, application, infrastructure, index.ts }
    production/    { domain, application, infrastructure, index.ts }
    inventory/     { domain, application, infrastructure, index.ts }
    procurement/   { domain, application, infrastructure, index.ts }
    vendors/       { domain, application, infrastructure, index.ts }
    vessels/       { domain, application, infrastructure, index.ts }
    identity/      { domain, application, infrastructure, index.ts }
  server/
    db.ts                           # Prisma client singleton
    config.ts                       # validated environment
    errors.ts                       # AppError taxonomy
    http.ts                         # envelope + error mapping + handler wrapper
    actor.ts                        # current-actor resolution
    audit.ts                        # audit event writer
  shared/
    schemas/                        # Zod contracts — client AND server
    units/                          # unit registry + conversion (pure)
    money.ts                        # Decimal handling and INR formatting
  components/
    ui/                             # presentational primitives
    <feature>/                      # feature components
prisma/
  schema.prisma
  migrations/
  seed/                             # seed split by module
docs/
  system-design.md                  # this file
  runbook.md                        # deploy and operate
tests/
  unit/                             # domain rules, no database
  integration/                      # use cases against a real database
  api/                              # route contract tests
```

### 4.3 Cross-module reads

Modules need each other's data — procurement needs cycle assignments, production needs recipes. This happens through a **published query interface** exported from the owning module's barrel, returning that module's domain types:

```ts
// procurement/application/generate-purchase-orders.ts
import { getWeekDemandInputs } from "@/modules/cycles";   // ✅ published interface
import { cycleDayRepository } from "@/modules/cycles/infrastructure"; // ❌ never
```

A module that needs another module's *tables* is a module boundary drawn in the wrong place. Fix the boundary, don't reach through it.

---

## 5. Data model

UUID primary keys. UTC timestamps. `createdAt` / `updatedAt` everywhere. Decimal for money and quantities — never float. Soft delete only where recovery or audit matters (ingredients, recipes, vendors); hard delete elsewhere.

```
User ──< AuditEvent

SubscriptionPlan ──< Subscriber ──< VesselKit

Cycle ──< CycleDay ──< MealAssignment >── RecipeVersion ──< RecipeIngredient >── Ingredient
  │           └──< PrepTask                    │
  │                                            ├──< RecipeStep
  └──< PurchaseOrder ──< PurchaseOrderLine     └──< RecipeAllergen
              │                  │
              └── Vendor         └── Ingredient
                    │
                    └──< VendorIngredient >── Ingredient
                                                 ├─── InventoryBalance
                                                 └──< InventoryMovement
```

### 5.1 Constraints that must exist in the database

Application-level checks are a convenience; the database is the guarantee.

| Constraint | Why |
| --- | --- |
| `cycles.cycle_number` unique | One cycle per sequence number |
| `cycle_days (cycle_id, day_number)` unique | No duplicate days |
| `meal_assignments (cycle_day_id, meal_type)` unique | One dish per slot |
| `recipe_versions (recipe_id, version_number)` unique | Version integrity |
| `recipe_ingredients (recipe_version_id, ingredient_id, unit)` unique | No duplicate lines |
| `recipe_steps (recipe_version_id, step_number)` unique | Ordered method |
| `ingredients.normalized_name` unique | Deduplicates the master list |
| `inventory_balances.ingredient_id` unique | One balance per ingredient (BR-11). Multi-location deferred — `location` is recorded but the MVP assumes one kitchen |
| `vendor_ingredients (vendor_id, ingredient_id)` unique | One price per pair |
| **`prep_tasks (cycle_id, source_key)` unique** | BR-16 idempotency |
| **`purchase_orders (cycle_id, vendor_id, week_number)` unique** | BR-16 idempotency |
| `purchase_order_lines (purchase_order_id, ingredient_id)` unique | No duplicate lines |
| `vendors.name` unique | Prevents the duplicate-vendor drift the prototype had |

Foreign keys use `RESTRICT` for operational records that must not vanish (ingredients, recipe versions, vendors) and `CASCADE` only for records that are meaningless without their parent (recipe steps, PO lines, meal assignments).

### 5.2 Indexes

`cycles(status)`, `cycle_days(cycle_id, week_number)`, `recipes(meal_type, active)`, `ingredients(category, active)`, `ingredients(inventory_managed, active)`, `prep_tasks(cycle_id, status, due_date)`, `inventory_movements(ingredient_id, created_at)`, `purchase_orders(status, vendor_id)`, `audit_events(entity_type, entity_id, created_at)`.

---

## 6. Quantities and units

This is the single most dangerous area of the system, and the prototypes did not solve it. Recipes are written in cooking units — `150g` chicken, `8ml` olive oil, `¼ tsp` turmeric, `1 bunch` coriander. Stock and vendor pricing are in purchase units — `kg`, `L`, `pcs`. Comparing a demand of `150` against a stock of `2` because one is grams and the other is kilograms produces a purchase order that is wrong by three orders of magnitude.

### 6.1 The rule

Every quantity is a `(amount, unit)` pair. Conversion happens through a **canonical base unit per dimension**:

| Dimension | Base | Members |
| --- | --- | --- |
| `MASS` | `g` | `mg` 0.001, `g` 1, `kg` 1000 |
| `VOLUME` | `ml` | `ml` 1, `tsp` 5, `tbsp` 15, `cup` 240, `L` 1000 |
| `COUNT` | `pcs` | `pcs` 1, `dozen` 12 |
| `OPAQUE` | itself | `bunch`, `portion`, `slice`, `pinch`, `roll`, `btl`, `leaf`, `sprig`, … |

`OPAQUE` units are each their own dimension. A `bunch` converts to a `bunch` and to nothing else — because there is no honest answer to "how many kilograms is a bunch of coriander", and inventing one silently is worse than refusing.

### 6.2 Where conversion happens

- **`InventoryBalance.quantity` is always expressed in `Ingredient.defaultUnit`.** This is the ingredient's stock unit and the invariant the whole inventory module relies on.
- Recipe ingredient quantities are stored **as authored**, in whatever unit the recipe uses. Recipes must stay readable to a chef.
- Demand aggregation (BR-6) converts each recipe line into the ingredient's stock unit before summing.
- A line whose unit cannot be converted to the ingredient's stock unit does **not** get silently dropped or silently summed. It surfaces as an `UNCONVERTIBLE_UNIT` exception on the generation result, naming the ingredient and both units, so a human can fix the recipe or the ingredient definition.

Conversion is a pure function in `shared/units`, fully unit-tested, with no knowledge of the database.

---

## 7. API contract

All endpoints live under `/api/v1`, accept and return JSON, validate every input with Zod, and use one envelope.

**Success**
```json
{ "data": {}, "meta": { "requestId": "uuid" } }
```

**Error**
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "fields": {}, "details": {} },
  "meta": { "requestId": "uuid" } }
```

### 7.1 Error taxonomy

Every failure maps to exactly one code and status. Nothing reaches the client as an unclassified 500 except a genuine unhandled defect, and those never leak a stack trace or a database message.

| Code | Status | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Zod rejected the body, query, or path params |
| `UNAUTHENTICATED` | 401 | No valid actor |
| `FORBIDDEN` | 403 | Actor's role does not permit this |
| `NOT_FOUND` | 404 | Entity does not exist (Prisma `P2025`) |
| `CONFLICT` | 409 | Uniqueness violated (Prisma `P2002`) |
| `INVALID_TRANSITION` | 409 | Illegal lifecycle move (BR-12) |
| `UNPROCESSABLE` | 422 | Business rule refused it (BR-4, BR-5) |
| `INSUFFICIENT_STOCK` | 422 | BR-10, with the shortfall in `details` |
| `UNCONVERTIBLE_UNIT` | 422 | §6.2, with ingredient and both units in `details` |
| `INTERNAL_ERROR` | 500 | Unhandled. Logged with the request ID; opaque to the client |

The request ID appears in both the response and the server log line, so a user reporting "it failed" can be traced to an exact log entry.

### 7.2 Endpoints

**Cycles and planning**

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/cycles` | List with status and counts |
| `POST` | `/cycles` | Create a draft cycle with its days |
| `GET` | `/cycles/:id` | Calendar and assignments |
| `PATCH` | `/cycles/:id` | Edit metadata (name, dates, subscribers, targets) |
| `DELETE` | `/cycles/:id` | Delete — drafts only |
| `POST` | `/cycles/:id/publish` | Validate (BR-4) and activate atomically |
| `PUT` | `/cycles/:id/days/:day/meals/:meal` | Assign a recipe version (BR-5) |
| `DELETE` | `/cycles/:id/days/:day/meals/:meal` | Clear a slot |
| `GET` | `/cycles/:id/conflicts` | Protein conflicts (BR-1, BR-2) |
| `GET` | `/cycles/:id/prep-tasks` | List advance-prep tasks |
| `POST` | `/cycles/:id/prep-tasks/generate` | Idempotent generation (BR-3, BR-16) |
| `PATCH` | `/prep-tasks/:id` | Complete, reopen, or skip |
| `GET` | `/cycles/:id/production?week=n` | Weekly production projection |
| `POST` | `/cycles/:id/days/:day/consume` | Record production consumption (BR-14) |

**Recipes**

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/recipes` | Search and filter |
| `POST` | `/recipes` | Create recipe with initial draft version |
| `GET` | `/recipes/:id` | Recipe with all versions |
| `PATCH` | `/recipes/:id` | Edit stable identity fields |
| `DELETE` | `/recipes/:id` | Archive |
| `POST` | `/recipes/:id/versions` | New draft version, optionally cloned |
| `GET` | `/recipe-versions/:id` | Execution card |
| `PATCH` | `/recipe-versions/:id` | Edit — drafts only (BR-15) |
| `POST` | `/recipe-versions/:id/publish` | Draft → published |

**Inventory**

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/ingredients` | List (filtered, paged) / create |
| `GET` / `PATCH` / `DELETE` | `/ingredients/:id` | Fetch / update / archive |
| `GET` | `/inventory/summary` | KPIs, below-par list, projected spend |
| `GET` / `POST` | `/inventory/movements` | History / record a movement (BR-9, BR-10) |
| `GET` | `/inventory/export.csv` | Full inventory projection |

**Vendors and procurement**

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/vendors` | List / create |
| `GET` / `PATCH` / `DELETE` | `/vendors/:id` | Fetch / update / deactivate |
| `PUT` | `/vendors/:id/ingredients/:ingredientId` | Set price, unit, preferred flag |
| `GET` / `POST` | `/purchase-orders` | List / create manually |
| `POST` | `/purchase-orders/generate` | Generate for a cycle week (BR-6, BR-7, BR-16) |
| `GET` / `PATCH` | `/purchase-orders/:id` | Fetch / transition status (BR-12) |
| `POST` | `/purchase-orders/:id/receive` | Record receipt → stock (BR-13) |
| `GET` | `/purchase-orders/:id/outreach` | Vendor message + WhatsApp deep link |

**Finance**

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/finance/months/:month` | Month view: ledger with balances, totals, weeks, categories, fixed costs, flags, unimported orders (BR-20) |
| `PUT` | `/finance/months/:month/opening-balance` | Set, or clear with `null` (BR-20) |
| `POST` | `/finance/months/:month/import-purchase-orders` | Idempotent import of received orders (BR-21) |
| `GET` | `/finance/months/:month/export.csv` | Month ledger as CSV |
| `POST` | `/finance/transactions` | Record a transaction (BR-19) |
| `PATCH` / `DELETE` | `/finance/transactions/:id` | Edit / delete |
| `GET` / `POST` | `/finance/recurring-costs` | List / create fixed costs |
| `PATCH` / `DELETE` | `/finance/recurring-costs/:id` | Edit / deactivate |
| `POST` | `/finance/recurring-costs/:id/post` | Log as paid for a month (BR-22) |

**Vessels and reference**

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/vessel-kits` | Registry |
| `PATCH` | `/vessel-kits/:id` | Update status, sanitisation |
| `GET` | `/vessel-kits/summary` | Rotation and replacement view |
| `GET` / `POST` | `/subscribers` | Roster |
| `GET` | `/health` | Liveness and database check |

---

## 8. Identity, authorisation, and audit

### 8.1 Actor

Every mutation runs as an **actor**. `server/actor.ts` exposes a single `resolveActor(request)` used by every handler. In the MVP it resolves a seeded operations user; swapping in real sessions changes that one file and nothing else.

This matters now, not later: `InventoryMovement.actorId`, `PrepTask.completedById`, and every `AuditEvent` need a real actor from the first write. Backfilling attribution onto historical rows is impossible.

### 8.2 Roles

`ADMIN`, `PLANNER`, `KITCHEN`, `PROCUREMENT`, `VIEWER`. Role checks live in **use cases**, not route handlers, so they cannot be bypassed by a second caller.

| Capability | Roles |
| --- | --- |
| Manage cycles, assignments, publish | `ADMIN`, `PLANNER` |
| Manage recipes and versions | `ADMIN`, `PLANNER` |
| Complete prep tasks, record consumption | `ADMIN`, `KITCHEN` |
| Manage ingredients, vendors, purchase orders, receiving | `ADMIN`, `PROCUREMENT` |
| Read everything | all roles including `VIEWER` |

### 8.3 Audit

Every mutating use case writes an `AuditEvent` with actor, action, entity type and ID, before and after snapshots, and the request ID — in the **same transaction** as the change, so an audit trail can never disagree with the data. Audit writes never contain secrets or vendor contact details.

---

## 9. Deployment

### 9.1 Topology

```
Browser → Vercel (Next.js on Fluid Compute, Node.js runtime)
             │
             ├── DATABASE_URL  → Neon pooled endpoint  (runtime queries)
             └── DIRECT_URL    → Neon direct endpoint  (migrations only)
```

The Node.js runtime is used throughout — not Edge. Prisma, transactions, and the seed all need full Node, and Fluid Compute already gives low cold starts in the same regions.

### 9.2 Connection strategy

Neon requires a **pooled** connection for serverless runtime traffic and a **direct** one for migrations, because migrations take advisory locks that a transaction pooler cannot hold. Prisma supports this natively via `datasource.directUrl`, which the schema already declares.

Local Docker PostgreSQL sets both variables to the same URL. No code branches on environment; the difference is entirely configuration, which is what keeps local and hosted on one migration path.

### 9.3 Environment

| Variable | Scope | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | runtime + build | Pooled connection |
| `DIRECT_URL` | migrations | Unpooled connection |
| `APP_URL` | runtime | Absolute URL generation |
| `SEED_ON_DEPLOY` | preview only | Guards destructive seeding |

`server/config.ts` validates these at startup with Zod and fails loudly on a missing or malformed value, rather than surfacing as a confusing connection error on the first request.

### 9.4 Build

`prisma generate` runs in `postinstall` so Vercel's build has a client. Migrations run as a deploy step (`prisma migrate deploy`), never automatically at runtime.

---

## 10. Testing strategy

| Layer | Tool | Covers |
| --- | --- | --- |
| **Unit** | Vitest, no database | Every rule in §3 and all of §6. Fast, exhaustive, run on every save. |
| **Integration** | Vitest + test database | Use cases: transaction boundaries, idempotent regeneration, receive-to-stock, negative-stock refusal, audit writes. |
| **API contract** | Vitest against route handlers | Envelope shape, every error code in §7.1, lifecycle transitions, validation rejection. |
| **End-to-end** | Playwright | One smoke path: create cycle → assign → publish → generate prep → generate PO → receive → verify stock. |

The domain layer is pure, so the majority of business risk is covered by tests that need no database and run in milliseconds. That is the main practical payoff of the layering.

---

## 11. Migration from the prototypes

1. Extract `CYCLE`, `RECIPES`, and the inventory `state` seeds into module-scoped seed files. *(Currently done by regex-scraping the HTML at seed time — replace with committed JSON fixtures so seeding does not depend on files that are scheduled for deletion.)*
2. Reach behavioural parity screen by screen, checking each against §3.
3. Retire an HTML file only once its replacement is accepted by the chef.

**Parity checklist** — behaviour the prototypes have, and whether the application has it:

| Prototype behaviour | Status |
| --- | --- |
| Editable ingredient master | ✅ Every cell commits on blur; archive works |
| Rich vendor outreach message with WhatsApp deep link | ✅ Server-generated from the full template |
| Cost by vendor, cost by frequency, and the P&L block | ✅ Priced from real weekly demand, not a frozen constant |
| Advance-prep lead-time badges, grouped by week and day | ✅ Plus real due dates, which the prototype never computed |
| Suggested protein swaps on conflicts | ✅ Shown in the conflicts tab and the day modal |
| Sortable ingredient table with per-category counts | ✅ |
| Full CSV column set | ✅ Plus a stock-status column the prototype lacked |
| Weekly brief bar with persistence, and "start new week" | ⚠️ **Deferred.** See below |

The **weekly brief bar** (week, subscribers, cycle days, chef, ordering status, food-cost
target) was uncontrolled inputs bound to `localStorage` in the prototype and bound to
nothing in the React rewrite. Its durable fields — `chefName`, `subscriberCount`,
`foodCostTargetPercent`, `weekStart` — now live on the `Cycle` record and are editable
through `POST /cycles` and `PATCH /cycles/:id`, but no brief-bar UI surfaces them on the
inventory screen. "Start new week", which bulk-reset every ingredient's status back to
`needed`, is deliberately not reimplemented: with real purchase orders carrying lifecycle
state (BR-12), a global status reset would destroy procurement history. The equivalent
operation is generating purchase orders for the next week.

---

## 12. Decision log

| Date | Decision | Reason | Alternatives considered |
| --- | --- | --- | --- |
| 2026-07-22 | Modular monolith on Next.js + PostgreSQL | One team, one database; distribution buys nothing here | Microservices, serverless functions per module |
| 2026-07-22 | Prisma migrations with `DATABASE_URL` abstraction | Keeps local Docker and hosted Neon on one migration path | Raw SQL migrations, Drizzle |
| 2026-07-31 | Canonical base units with `OPAQUE` dimension (§6) | Recipe units and purchase units genuinely differ; silent coercion produces wrong purchase orders | Force recipe units to match stock units; per-ingredient conversion factor |
| 2026-07-31 | Natural-key idempotency for generated rows (BR-16) | Delete-and-recreate destroyed completion state and duplicated tasks | Version stamps, full regeneration |
| 2026-07-31 | Actor threaded from day one, real auth later | Attribution cannot be backfilled | Defer actor entirely until auth lands |
| 2026-07-31 | Subscription plans replace the hardcoded revenue constant (BR-17) | The 22/10/5 mix was frozen in a formula; the roster changes | Keep the constant, make it a cycle-level setting |
| 2026-07-31 | Node.js runtime on Vercel, not Edge | Prisma and transactions need full Node; Fluid Compute removes the cold-start argument | Edge runtime with a HTTP database driver |
| 2026-07-31 | Squashed three dev migrations into one baseline | Never deployed; the history contained a column added, dropped, then re-added. An honest baseline beats a misleading history | Keep the history and add a corrective migration |
| 2026-07-31 | Prototype data committed as JSON fixtures | The seed regex-scraped HTML files that are scheduled for deletion | Keep scraping; hand-write the seed |
| 2026-07-31 | Shelf life excluded from lead-time parsing (BR-3) | "Pre-make basil oil (3 days shelf life)" was scheduled 3 days early, arriving at the end of its life on service day | Match the prototype's behaviour exactly |
| 2026-07-31 | Request ID injected centrally in `route()` | Stamping it in `ok()` meant any handler could forget it and silently break the §7 envelope | Pass the request ID to every `ok()` call |
| 2026-07-31 | Architectural boundaries enforced by ESLint | A layering rule that is only in a document is a rule that erodes | Code review; import-path conventions |

---

## 13. Definition of done for the MVP

- A fresh checkout starts PostgreSQL, migrates, seeds, and runs from documented commands.
- The same commit deploys to Vercel against Neon with only environment differences.
- A user can create a cycle, assign every slot, publish it, generate prep, generate purchase orders, receive goods, and see stock change — with each step traceable in the audit log.
- Re-running any generation command changes no completed work and creates no duplicates.
- Every rule in §3 has a unit test; the smoke path has an end-to-end test.
- No endpoint returns an unclassified 500 for a foreseeable condition.
- Every parity item in §11 is either implemented or explicitly deferred with a reason.
