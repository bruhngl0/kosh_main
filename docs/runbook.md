# Kōsh — Operations Runbook

Companion to `docs/system-design.md`. This is how to run, test, and deploy the platform.

---

## 1. Local development

Prerequisites: Node 20+, Docker, npm.

```bash
cp .env.example .env          # defaults already point at the Docker database
docker compose up -d postgres
npm install                   # postinstall runs `prisma generate`
npm run db:migrate            # applies migrations, creates the schema
npm run db:seed               # loads the prototype fixtures
npm run db:enrich             # fills the gaps the prototypes left (see below)
npm run dev                   # http://localhost:3000
```

The seed is idempotent — re-run it whenever you want the reference data back.

`npm run db:reset` drops everything, re-migrates, and re-seeds. It is destructive and
refuses to run without confirmation.

### What the seed creates

| Records | Detail |
| --- | --- |
| 5 users | One per role, so authorisation can be exercised (§8.2) |
| 3 plans, 37 subscribers | The 22/10/5 mix the prototype hardcoded (BR-17) |
| 7 vendors | The real Bengaluru suppliers from the prototype |
| 18 ingredients | Inventory master, with balances, par levels, and vendor pricing |
| 112 recipes | 37 detailed execution cards + 75 menu outlines |
| Cycle 01 | 28 days, 112 meal assignments, starting 3 Aug 2026 |
| 5 vessel kits | Subscriber registry |

Source data lives in `prisma/seed/fixtures/*.json`, extracted once from the three HTML
prototypes. The seed no longer parses the HTML at run time, so the prototypes can be
retired without breaking anything.

### `db:enrich` — filling what the prototypes left out

Only 37 of the 112 prototype dishes shipped with execution cards. The rest had a title
and nutrition but no ingredient lines, so they contributed no demand and purchase-order
generation covered a third of the menu.

`npm run db:enrich` closes that gap **additively** — it only fills empty content and
never overwrites anything that exists, so it is safe to run against a live database and
safe to re-run (a second pass finds nothing to do).

| It adds | It never touches |
| --- | --- |
| Ingredient lines for versions that have none | Any version that already has ingredients |
| A method, replacing the placeholder step | A version with a real method already |
| A preferred vendor + pricing where none is set | An ingredient that already has a preferred vendor |
| A real category, replacing the importer's `recipe` placeholder | Ingredients already on a real category |

Ingredients are derived from each dish's own subtitle — which lists its components,
`Brown rice · raita · amaranth greens` — so the result is dish-specific rather than
random filler. Recipe units are chosen to share a dimension with the ingredient's stock
unit, so demand aggregation stays convertible (§6.2).

After enrichment, across the 28-day cycle: **0 unsourced ingredients**, ~110 order lines
per week, and food cost in a believable range.

**This is synthetic pricing.** Unit costs are indicative figures by category, not real
vendor quotes. Replace them with actual prices before trusting any cost projection.

---

## 2. Tests

```bash
npm test                  # unit — pure domain rules, no database, ~0.5s
npm run test:integration  # integration + API contract, needs PostgreSQL
npm run test:all          # both
```

Integration tests read `.env.test`, which points at a **separate `kosh_test` database**.
Create it once:

```bash
docker exec kosh-postgres psql -U kosh -c "CREATE DATABASE kosh_test;"
```

These tests truncate tables between cases. Never point `.env.test` at a database you
care about.

| Suite | Count | Covers |
| --- | --- | --- |
| `tests/unit` | 180 | Every rule in system-design §3, plus the unit system in §6 |
| `tests/integration` | 47 | Transactions, idempotent regeneration, receive-to-stock, negative-stock refusal, audit writes |
| `tests/api` | 18 | Response envelope, every error code in §7.1, validation, CSV export |

---

## 3. Quality gates

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint, including architectural boundary rules
npm run build       # prisma generate && next build
```

ESLint enforces two boundaries from system-design §4:

- `src/modules/*/domain/**` may not import Prisma, `@/server/*`, or Next. The domain
  layer stays pure and therefore stays testable without a database.
- `src/app/api/**/route.ts` may not import a module's `application/` or
  `infrastructure/` internals — only its public barrel, `@/modules/<name>`.

A violation is a build failure, not a code-review conversation.

---

## 4. Deploying to Vercel + Neon

### 4.1 Create the Neon database

1. Create a Neon project and a database named `kosh`.
2. Copy **both** connection strings from the Neon dashboard:
   - **Pooled** — hostname contains `-pooler`. This is `DATABASE_URL`.
   - **Direct** — no `-pooler`. This is `DIRECT_URL`.

Both matter. Serverless functions open many short-lived connections and would exhaust
Neon's limit without the pooler; migrations take advisory locks that a transaction
pooler cannot hold, so they need the direct endpoint. Prisma routes each to the right
place via `datasource.directUrl`, already declared in `prisma/schema.prisma`.

### 4.2 Configure Vercel

```bash
vercel link
vercel env add DATABASE_URL production   # pooled
vercel env add DIRECT_URL production     # direct
vercel env add APP_URL production        # https://your-app.vercel.app
```

Repeat for the `preview` environment if you want preview deployments to have their own
Neon branch — which is the recommended setup, since Neon branches are cheap and it keeps
preview data away from production.

### 4.3 Migrate and seed

Migrations are **not** run automatically at runtime. Run them deliberately:

```bash
DATABASE_URL="<direct-url>" DIRECT_URL="<direct-url>" npx prisma migrate deploy
```

Seeding a fresh preview database:

```bash
DATABASE_URL="<direct-url>" DIRECT_URL="<direct-url>" npm run db:seed
```

Never seed production after go-live — the seed asserts reference data and will overwrite
the menu.

### 4.3a Link the onboarding app

Confirmed applicants in `koshOnboarding` become subscribers here (BR-23). Generate one
shared secret and set it on both projects:

```bash
openssl rand -hex 32                                   # the shared token
vercel env add ONBOARDING_SYNC_TOKEN production         # in kosh-main (this repo)
# in koshOnboarding:
vercel env add KOSH_OPS_URL production                  # e.g. https://kosh.vercel.app
vercel env add KOSH_OPS_SYNC_TOKEN production           # the same token
```

Optional here: `SUBSCRIBER_CAPACITY` (default 40). Redeploy both, then in the onboarding
admin press **⇄ Sync confirmed to Ops** once to backfill everyone confirmed before the link
existed. It is safe to press again at any time.

### 4.4 Deploy

```bash
vercel --prod
```

`vercel.json` sets the build command to `prisma generate && next build` and raises the
API function timeout to 60s, which covers purchase-order generation across a full cycle
week.

### 4.5 Verify

```bash
curl -s https://your-app.vercel.app/api/v1/health
# {"data":{"status":"ok","service":"kosh","databaseLatencyMs":12,...},"meta":{"requestId":"..."}}
```

`databaseLatencyMs` above ~200ms usually means the function region and the Neon region
disagree. Set the Vercel function region to match Neon's.

### 4.6 Runtime notes

- Everything runs on the **Node.js runtime**, not Edge. Prisma and interactive
  transactions need full Node, and Fluid Compute already gives low cold starts.
- The Prisma client is cached on `globalThis` so warm invocations reuse a connection
  rather than opening a new one per request.
- All pages are `force-dynamic`: this is an internal operations tool where showing stale
  stock would be worse than a slightly slower page.

---

## 5. Operating the platform

### The weekly loop

```
1. Plan       /cycles          assign every slot, check the conflicts tab
2. Publish    Publish Cycle    validates all four slots per day (BR-4)
3. Prep       Generate Prep    idempotent; completed work is preserved (BR-16)
4. Buy        /inventory → Outreach → pick week → Generate orders
5. Send       Copy message or open WhatsApp directly
6. Receive    Receive goods    writes RECEIVE movements → stock goes up (BR-13)
7. Cook       Record production → writes CONSUME movements → stock goes down (BR-14)
8. Money      /finance → add received orders to the ledger, post fixed costs, log subscription payments
```

### Things that will legitimately refuse you

| Message | Why | Fix |
| --- | --- | --- |
| `This cycle cannot be published yet` | A day is missing a slot, or a slot holds an unpublished recipe | The error lists the days; fill them, or publish the recipe version |
| `... has N available but M was requested` | Production or consumption would drive stock negative (BR-10) | Receive stock first, or record an authorised override |
| `... is measured in "bunch" which cannot be converted to "kg"` | A recipe unit and the ingredient's stock unit are different dimensions (§6.2) | Fix the recipe unit, or change the ingredient's stock unit |
| `N ingredient(s) needed but no preferred vendor is set` | Demand exists but nobody is set up to supply it (BR-7) | Set a preferred vendor on the ingredient |
| `Version N is published and cannot be edited` | Published recipe versions are immutable (BR-15) | Create a new version |
| `Purchase order cannot move from X to Y` | Illegal lifecycle transition (BR-12) | The error lists the allowed transitions |

None of these are bugs. Each one is a place where the old system silently did something
wrong instead.

### Diagnosing a failure

Every response carries a request ID, in the body's `meta.requestId` and in the
`x-request-id` header. A 500 logs one structured line with the same ID:

```bash
vercel logs --follow | grep '<request-id>'
```

Every mutation also writes an `audit_events` row with the actor, before/after snapshots,
and that request ID:

```sql
SELECT action, entity_type, entity_id, created_at
FROM audit_events
WHERE request_id = '<request-id>';
```

---

## 6. Known limitations

Deliberate for the MVP, listed so nobody mistakes them for oversights:

- **Finance reads are not restricted.** Writes need `finance:write` (ADMIN only), but
  like every other screen, `/finance` and its GET endpoints are open to anyone who can
  reach the app. The cash position is more sensitive than a recipe card, so this should
  close when real authentication lands.
- **Subscription revenue is entered by hand.** There is no payments integration, and
  onboarding (the separate `koshOnboarding` app) does not create `Subscriber` rows here.
- **No real authentication.** Every mutation runs as the seeded operations user. The
  actor is threaded through every use case already (§8.1), so adding sessions is a
  change to `src/server/actor.ts` alone.
- **Single inventory location.** `InventoryBalance.location` exists and is recorded, but
  the unique key is `ingredient_id`. Multi-location needs a schema change.
- **No Playwright suite yet.** The smoke path in system-design §10 is covered by
  integration tests but not through a browser.
- **Ingredient content and pricing outside the 37 detailed cards is synthetic.**
  `db:enrich` derives it from each dish's subtitle and prices it from category averages.
  It is plausible and internally consistent, not real. The 37 prototype cards are the
  chef's actual recipes; the other 75 are scaffolding to be replaced.
- **Three ingredients have unresolvable unit conflicts** and appear as exceptions on
  week 1 generation: avocado is stocked per piece but authored in grams, coconut oil is
  stocked in litres but authored in grams, black pepper is authored in teaspoons against
  a pinch. Each needs a human decision (weight per avocado, oil density) that the system
  deliberately refuses to guess. They exercise the exception path, so leaving them is
  useful during the trial.
