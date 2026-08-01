-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'PLANNER', 'KITCHEN', 'PROCUREMENT', 'VIEWER');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('BF', 'SN', 'LU', 'DI');

-- CreateEnum
CREATE TYPE "RecipeStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PrepTaskStatus" AS ENUM ('OPEN', 'DONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PrepTaskType" AS ENUM ('SAME_DAY', 'DAY_BEFORE', 'H24', 'D3');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('RECEIVE', 'CONSUME', 'ADJUST', 'WASTE', 'RETURN');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'OUTREACH_READY', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "duration_days" INTEGER NOT NULL DEFAULT 28,
    "status" "CycleStatus" NOT NULL DEFAULT 'DRAFT',
    "week_start" DATE,
    "subscriber_count" INTEGER NOT NULL DEFAULT 1,
    "food_cost_target_percent" DECIMAL(5,2),
    "chef_name" TEXT,
    "protein_window_days" INTEGER NOT NULL DEFAULT 4,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_days" (
    "id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "day_number" INTEGER NOT NULL,
    "week_number" INTEGER NOT NULL,
    "phase_label" TEXT NOT NULL,

    CONSTRAINT "cycle_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "meal_type" "MealType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_versions" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "RecipeStatus" NOT NULL DEFAULT 'DRAFT',
    "calories" DECIMAL(8,2),
    "protein_grams" DECIMAL(8,2),
    "carbs_grams" DECIMAL(8,2),
    "fat_grams" DECIMAL(8,2),
    "protein_source" TEXT,
    "plating_notes" TEXT,
    "created_by_id" UUID,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipe_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "default_unit" TEXT NOT NULL,
    "default_frequency" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "inventory_managed" BOOLEAN NOT NULL DEFAULT false,
    "quantity_needed" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "inventory_status" TEXT NOT NULL DEFAULT 'needed',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_ingredients" (
    "id" UUID NOT NULL,
    "recipe_version_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "preparation_note" TEXT,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_steps" (
    "id" UUID NOT NULL,
    "recipe_version_id" UUID NOT NULL,
    "step_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "temperature_c" DECIMAL(6,2),
    "duration_minutes" INTEGER,
    "criticality" TEXT NOT NULL DEFAULT 'info',

    CONSTRAINT "recipe_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_allergens" (
    "id" UUID NOT NULL,
    "recipe_version_id" UUID NOT NULL,
    "allergen_code" TEXT NOT NULL,

    CONSTRAINT "recipe_allergens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_assignments" (
    "id" UUID NOT NULL,
    "cycle_day_id" UUID NOT NULL,
    "meal_type" "MealType" NOT NULL,
    "recipe_version_id" UUID NOT NULL,
    "servings" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prep_tasks" (
    "id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "cycle_day_id" UUID NOT NULL,
    "meal_assignment_id" UUID,
    "source_key" TEXT NOT NULL,
    "task_text" TEXT NOT NULL,
    "task_type" "PrepTaskType" NOT NULL,
    "due_date" DATE,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "status" "PrepTaskStatus" NOT NULL DEFAULT 'OPEN',
    "completed_by_id" UUID,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prep_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "contact" TEXT,
    "whatsapp" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "minimum_order" TEXT,
    "lead_time" TEXT,
    "cutoff" TEXT,
    "area" TEXT,
    "payment_terms" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_ingredients" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "unit_cost" DECIMAL(12,2),
    "unit" TEXT,
    "minimum_qty" DECIMAL(12,3),
    "preferred" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_balances" (
    "id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "location" TEXT NOT NULL DEFAULT 'main-kitchen',
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "par_level" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "reorder_point" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "type" "InventoryMovementType" NOT NULL,
    "quantity_delta" DECIMAL(12,3) NOT NULL,
    "balance_after" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_cost" DECIMAL(12,2),
    "reason" TEXT,
    "reference" TEXT,
    "location" TEXT NOT NULL DEFAULT 'main-kitchen',
    "negative_override" BOOLEAN NOT NULL DEFAULT false,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "cycle_id" UUID,
    "week_number" INTEGER,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "ordered_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "requested_qty" DECIMAL(12,3) NOT NULL,
    "ordered_qty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "received_qty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL,
    "unit_cost" DECIMAL(12,2),
    "notes" TEXT,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "daily_rate" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscribers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "plan_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vessel_kits" (
    "id" UUID NOT NULL,
    "subscriber_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sets" INTEGER NOT NULL DEFAULT 2,
    "issued_at" DATE,
    "sanitised_at" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vessel_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "cycles_cycle_number_key" ON "cycles"("cycle_number");

-- CreateIndex
CREATE INDEX "cycles_status_idx" ON "cycles"("status");

-- CreateIndex
CREATE INDEX "cycle_days_cycle_id_week_number_idx" ON "cycle_days"("cycle_id", "week_number");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_days_cycle_id_day_number_key" ON "cycle_days"("cycle_id", "day_number");

-- CreateIndex
CREATE INDEX "recipes_meal_type_active_idx" ON "recipes"("meal_type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_title_meal_type_key" ON "recipes"("title", "meal_type");

-- CreateIndex
CREATE INDEX "recipe_versions_status_idx" ON "recipe_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_versions_recipe_id_version_number_key" ON "recipe_versions"("recipe_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_normalized_name_key" ON "ingredients"("normalized_name");

-- CreateIndex
CREATE INDEX "ingredients_category_active_idx" ON "ingredients"("category", "active");

-- CreateIndex
CREATE INDEX "ingredients_inventory_managed_active_idx" ON "ingredients"("inventory_managed", "active");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_ingredients_recipe_version_id_ingredient_id_unit_key" ON "recipe_ingredients"("recipe_version_id", "ingredient_id", "unit");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_steps_recipe_version_id_step_number_key" ON "recipe_steps"("recipe_version_id", "step_number");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_allergens_recipe_version_id_allergen_code_key" ON "recipe_allergens"("recipe_version_id", "allergen_code");

-- CreateIndex
CREATE UNIQUE INDEX "meal_assignments_cycle_day_id_meal_type_key" ON "meal_assignments"("cycle_day_id", "meal_type");

-- CreateIndex
CREATE INDEX "prep_tasks_cycle_id_status_due_date_idx" ON "prep_tasks"("cycle_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "prep_tasks_cycle_id_source_key_key" ON "prep_tasks"("cycle_id", "source_key");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_name_key" ON "vendors"("name");

-- CreateIndex
CREATE INDEX "vendor_ingredients_ingredient_id_preferred_idx" ON "vendor_ingredients"("ingredient_id", "preferred");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_ingredients_vendor_id_ingredient_id_key" ON "vendor_ingredients"("vendor_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_balances_ingredient_id_key" ON "inventory_balances"("ingredient_id");

-- CreateIndex
CREATE INDEX "inventory_movements_ingredient_id_created_at_idx" ON "inventory_movements"("ingredient_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_movements_type_created_at_idx" ON "inventory_movements"("type", "created_at");

-- CreateIndex
CREATE INDEX "purchase_orders_status_vendor_id_idx" ON "purchase_orders"("status", "vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_cycle_id_vendor_id_week_number_key" ON "purchase_orders"("cycle_id", "vendor_id", "week_number");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_purchase_order_id_ingredient_id_key" ON "purchase_order_lines"("purchase_order_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_name_key" ON "subscription_plans"("name");

-- CreateIndex
CREATE INDEX "subscribers_status_idx" ON "subscribers"("status");

-- CreateIndex
CREATE INDEX "vessel_kits_status_idx" ON "vessel_kits"("status");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_created_at_idx" ON "audit_events"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_id_created_at_idx" ON "audit_events"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "cycle_days" ADD CONSTRAINT "cycle_days_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_version_id_fkey" FOREIGN KEY ("recipe_version_id") REFERENCES "recipe_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_steps" ADD CONSTRAINT "recipe_steps_recipe_version_id_fkey" FOREIGN KEY ("recipe_version_id") REFERENCES "recipe_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_allergens" ADD CONSTRAINT "recipe_allergens_recipe_version_id_fkey" FOREIGN KEY ("recipe_version_id") REFERENCES "recipe_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_assignments" ADD CONSTRAINT "meal_assignments_cycle_day_id_fkey" FOREIGN KEY ("cycle_day_id") REFERENCES "cycle_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_assignments" ADD CONSTRAINT "meal_assignments_recipe_version_id_fkey" FOREIGN KEY ("recipe_version_id") REFERENCES "recipe_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prep_tasks" ADD CONSTRAINT "prep_tasks_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prep_tasks" ADD CONSTRAINT "prep_tasks_cycle_day_id_fkey" FOREIGN KEY ("cycle_day_id") REFERENCES "cycle_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prep_tasks" ADD CONSTRAINT "prep_tasks_meal_assignment_id_fkey" FOREIGN KEY ("meal_assignment_id") REFERENCES "meal_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prep_tasks" ADD CONSTRAINT "prep_tasks_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_ingredients" ADD CONSTRAINT "vendor_ingredients_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_ingredients" ADD CONSTRAINT "vendor_ingredients_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_kits" ADD CONSTRAINT "vessel_kits_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
