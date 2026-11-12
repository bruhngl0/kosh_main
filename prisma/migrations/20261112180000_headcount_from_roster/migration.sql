-- BR-30: servings follow the subscriber roster unless set by hand.
ALTER TABLE "cycles" ADD COLUMN "headcount_synced_at" TIMESTAMP(3);
ALTER TABLE "meal_assignments" ADD COLUMN "servings_locked" BOOLEAN NOT NULL DEFAULT false;

-- Nobody cooks for zero or fewer people.
ALTER TABLE "meal_assignments" ADD CONSTRAINT "meal_assignments_servings_positive" CHECK ("servings" > 0);
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_subscriber_count_positive" CHECK ("subscriber_count" > 0);
