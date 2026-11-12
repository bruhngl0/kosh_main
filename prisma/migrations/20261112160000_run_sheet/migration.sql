-- CreateTable
CREATE TABLE "run_sheets" (
    "id" UUID NOT NULL,
    "production_date" DATE NOT NULL,
    "chef_name" TEXT,
    "dispatch_window" TEXT,
    "special_notes" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "run_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_sheet_checks" (
    "id" UUID NOT NULL,
    "run_sheet_id" UUID NOT NULL,
    "task_key" TEXT NOT NULL,
    "done_by_id" UUID,
    "done_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_sheet_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_sheet_tasks" (
    "id" UUID NOT NULL,
    "run_sheet_id" UUID NOT NULL,
    "phase" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "owner" TEXT NOT NULL DEFAULT 'Chef',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_sheet_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vessel_dispatches" (
    "id" UUID NOT NULL,
    "run_sheet_id" UUID NOT NULL,
    "subscriber_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vessel_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "run_sheets_production_date_key" ON "run_sheets"("production_date");

-- CreateIndex
CREATE UNIQUE INDEX "run_sheet_checks_run_sheet_id_task_key_key" ON "run_sheet_checks"("run_sheet_id", "task_key");

-- CreateIndex
CREATE INDEX "run_sheet_tasks_run_sheet_id_idx" ON "run_sheet_tasks"("run_sheet_id");

-- CreateIndex
CREATE UNIQUE INDEX "vessel_dispatches_run_sheet_id_subscriber_id_key" ON "vessel_dispatches"("run_sheet_id", "subscriber_id");

-- AddForeignKey
ALTER TABLE "run_sheet_checks" ADD CONSTRAINT "run_sheet_checks_run_sheet_id_fkey" FOREIGN KEY ("run_sheet_id") REFERENCES "run_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_sheet_checks" ADD CONSTRAINT "run_sheet_checks_done_by_id_fkey" FOREIGN KEY ("done_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_sheet_tasks" ADD CONSTRAINT "run_sheet_tasks_run_sheet_id_fkey" FOREIGN KEY ("run_sheet_id") REFERENCES "run_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_dispatches" ADD CONSTRAINT "vessel_dispatches_run_sheet_id_fkey" FOREIGN KEY ("run_sheet_id") REFERENCES "run_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_dispatches" ADD CONSTRAINT "vessel_dispatches_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_dispatches" ADD CONSTRAINT "vessel_dispatches_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- BR-28: a vessel is out, collected or missing. "Not yet dispatched" is the absence of a row.
ALTER TABLE "vessel_dispatches" ADD CONSTRAINT "vessel_dispatches_status_known"
  CHECK ("status" IN ('out', 'collected', 'missing'));

-- Custom tasks belong to one of the standard phases.
ALTER TABLE "run_sheet_tasks" ADD CONSTRAINT "run_sheet_tasks_phase_known"
  CHECK ("phase" IN ('prep', 'cook', 'pack', 'dispatch', 'close', 'evening'));
