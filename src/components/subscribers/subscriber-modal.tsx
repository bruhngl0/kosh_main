"use client";

import { Field, Modal } from "@/components/ui/modal";
import type { SubscriberView } from "@/modules/subscribers";
import type { SubscriberStatus } from "@/shared/schemas/subscribers";
import { STATUS_LABELS, type Plan } from "./labels";

export type SubscriberDraft = {
  name: string;
  status: SubscriberStatus;
  planId: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  landmark: string | null;
  deliveryNote: string | null;
  deliverySlot: string | null;
  diet: string | null;
  allergies: string[];
  dislikes: string | null;
  medical: string | null;
  startDate: string | null;
  notes: string | null;
};

/** Readable labels for the onboarding answers kept in `profile`. */
const PROFILE_LABELS: [string, string, (v: unknown) => string][] = [
  ["goal", "Goal", String],
  ["activity", "Activity", String],
  ["weightKg", "Weight", (v) => `${v} kg`],
  ["heightCm", "Height", (v) => `${v} cm`],
  ["targetWeightKg", "Target", (v) => `${v} kg`],
  ["bmi", "BMI", String],
  ["spice", "Spice", String],
  ["cuisines", "Cuisines", (v) => (Array.isArray(v) ? v.join(", ") : String(v))],
  ["favouriteDish", "Favourite dish", String],
  ["gender", "Gender", String],
  ["dob", "Date of birth", String],
  ["clientNotes", "Notes for the chef", String],
];

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim() || null;

export function SubscriberModal({
  subscriber,
  plans,
  saving,
  onClose,
  onSave,
}: {
  subscriber: SubscriberView | null;
  plans: Plan[];
  saving: boolean;
  onClose: () => void;
  onSave: (draft: SubscriberDraft) => void;
}) {
  const s = subscriber;
  const profile = PROFILE_LABELS.filter(([key]) => s?.profile[key] !== undefined && s?.profile[key] !== null);

  return (
    <Modal
      title={s ? s.name : "Add Subscriber"}
      subtitle={
        s?.source === "onboarding"
          ? `From onboarding ${s.onboardingRef ?? ""} · last synced ${s.syncedAt ? new Date(s.syncedAt).toLocaleString("en-IN") : "—"}. Contact and diet update from the form; status, plan and notes are yours.`
          : undefined
      }
      wide
      onClose={onClose}
      saving={saving}
      onSubmit={(form) => {
        const data = new FormData(form);
        onSave({
          name: String(data.get("name") ?? "").trim(),
          status: data.get("status") as SubscriberStatus,
          planId: text(data, "planId"),
          phone: text(data, "phone"),
          email: text(data, "email"),
          address: text(data, "address"),
          landmark: text(data, "landmark"),
          deliveryNote: text(data, "deliveryNote"),
          deliverySlot: text(data, "deliverySlot"),
          diet: text(data, "diet"),
          allergies: String(data.get("allergies") ?? "")
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean),
          dislikes: text(data, "dislikes"),
          medical: text(data, "medical"),
          startDate: text(data, "startDate"),
          notes: text(data, "notes"),
        });
      }}
    >
      <div className="form-grid">
        <Field label="Full name *" name="name" defaultValue={s?.name ?? ""} required minLength={2} maxLength={150} full />
        <Field label="Status" name="status" as="select" defaultValue={s?.status ?? "active"}>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Field>
        <Field label="Plan" name="planId" as="select" defaultValue={s?.plan?.id ?? ""}>
          <option value="">— No plan —</option>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </Field>
        <Field label="Phone" name="phone" type="tel" defaultValue={s?.phone ?? ""} placeholder="+91 98450 00000" />
        <Field label="Email" name="email" type="email" defaultValue={s?.email ?? ""} />
        <Field label="Address" name="address" as="textarea" defaultValue={s?.address ?? ""} full rows={2} />
        <Field label="Landmark" name="landmark" defaultValue={s?.landmark ?? ""} />
        <Field label="Delivery slot" name="deliverySlot" as="select" defaultValue={s?.deliverySlot ?? ""}>
          <option value="">—</option>
          <option>Single Slot</option>
          <option>Multi Slot</option>
          {s?.deliverySlot && !["Single Slot", "Multi Slot"].includes(s.deliverySlot) && <option>{s.deliverySlot}</option>}
        </Field>
        <Field label="Delivery instructions" name="deliveryNote" defaultValue={s?.deliveryNote ?? ""} full />
        <Field label="Diet" name="diet" defaultValue={s?.diet ?? ""} placeholder="e.g. Vegetarian" />
        <Field label="Allergies" name="allergies" defaultValue={s?.allergies.join(", ") ?? ""} hint="Comma-separated" />
        <Field label="Dislikes / hard avoids" name="dislikes" as="textarea" defaultValue={s?.dislikes ?? ""} full rows={2} />
        <Field label="Medical conditions" name="medical" as="textarea" defaultValue={s?.medical ?? ""} full rows={2} />
        <Field label="Start date" name="startDate" type="date" defaultValue={s?.startDate ?? ""} hint="First delivery day" />
        <Field label="Ops notes" name="notes" as="textarea" defaultValue={s?.notes ?? ""} full rows={2} />
      </div>

      {profile.length > 0 && (
        <div className="subscriber-profile">
          <h3>From the onboarding form</h3>
          <dl>
            {profile.map(([key, label, format]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{format(s!.profile[key])}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Modal>
  );
}
