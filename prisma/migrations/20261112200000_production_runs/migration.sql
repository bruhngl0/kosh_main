-- BR-31: a cycle day's meal is taken off stock once.
-- CreateTable
CREATE TABLE "production_runs" (
    "id" UUID NOT NULL,
    "cycle_day_id" UUID NOT NULL,
    "meal_type" "MealType" NOT NULL,
    "reference" TEXT NOT NULL,
    "ingredient_count" INTEGER NOT NULL,
    "negative_override" BOOLEAN NOT NULL DEFAULT false,
    "recorded_by_id" UUID,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_runs_cycle_day_id_meal_type_key" ON "production_runs"("cycle_day_id", "meal_type");

-- AddForeignKey
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_cycle_day_id_fkey" FOREIGN KEY ("cycle_day_id") REFERENCES "cycle_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: days already consumed before this rule existed must not be consumed
-- again. Every past run wrote a `production.consumed` audit event naming the
-- cycle day and either "all" meals or the list it consumed.
INSERT INTO "production_runs" ("id", "cycle_day_id", "meal_type", "reference", "ingredient_count", "negative_override", "recorded_by_id", "recorded_at")
SELECT gen_random_uuid(), ma."cycle_day_id", ma."meal_type", 'Recorded before BR-31',
       COALESCE((ae."after"->>'ingredientCount')::int, 0),
       COALESCE((ae."after"->>'allowNegative')::boolean, false),
       ae."actor_id", ae."created_at"
FROM "audit_events" ae
JOIN "meal_assignments" ma ON ma."cycle_day_id"::text = ae."entity_id"
WHERE ae."action" = 'production.consumed'
  AND (jsonb_typeof(ae."after"->'meals') IS DISTINCT FROM 'array' OR ae."after"->'meals' ? ma."meal_type"::text)
ON CONFLICT ("cycle_day_id", "meal_type") DO NOTHING;
