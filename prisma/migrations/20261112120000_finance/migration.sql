-- CreateEnum
CREATE TYPE "CashDirection" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "cash_transactions" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "direction" "CashDirection" NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "purchase_order_id" UUID,
    "recurring_cost_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_costs" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_opening_balances" (
    "month" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_opening_balances_pkey" PRIMARY KEY ("month")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_transactions_purchase_order_id_key" ON "cash_transactions"("purchase_order_id");

-- CreateIndex
CREATE INDEX "cash_transactions_date_idx" ON "cash_transactions"("date");

-- CreateIndex
CREATE INDEX "cash_transactions_recurring_cost_id_date_idx" ON "cash_transactions"("recurring_cost_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_costs_name_key" ON "recurring_costs"("name");

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_recurring_cost_id_fkey" FOREIGN KEY ("recurring_cost_id") REFERENCES "recurring_costs"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Constraints Prisma cannot express (§5.1): the database is the guarantee.
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "recurring_costs" ADD CONSTRAINT "recurring_costs_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "cash_opening_balances" ADD CONSTRAINT "cash_opening_balances_month_format" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
