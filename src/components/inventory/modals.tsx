"use client";

import { useState } from "react";
import { Field, Modal } from "@/components/ui/modal";
import { CATEGORIES, STATUSES, type Ingredient, type PurchaseOrder, type Vendor } from "./types";

/** Forms for the inventory screen. Each returns a plain object to its caller. */

export function IngredientModal({
  vendors,
  saving,
  onClose,
  onSave,
}: {
  vendors: Vendor[];
  saving: boolean;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => void;
}) {
  return (
    <Modal
      title="Add Ingredient"
      subtitle="Stock is held in the unit you choose here; recipe units are converted against it."
      onClose={onClose}
      saving={saving}
      onSubmit={(form) => {
        const data = new FormData(form);
        const number = (key: string) => {
          const raw = data.get(key);
          return raw === null || raw === "" ? undefined : Number(raw);
        };
        onSave({
          name: data.get("name"),
          category: data.get("category"),
          defaultUnit: data.get("defaultUnit"),
          defaultFrequency: data.get("defaultFrequency"),
          status: data.get("status"),
          vendorId: data.get("vendorId") || undefined,
          purchaseUnit: data.get("purchaseUnit") || undefined,
          unitCost: number("unitCost"),
          quantityNeeded: number("quantityNeeded") ?? 0,
          parLevel: number("parLevel") ?? 0,
          quantity: number("quantity") ?? 0,
          notes: data.get("notes") || undefined,
        });
      }}
    >
      <div className="form-grid">
        <Field label="Ingredient name *" name="name" required full placeholder="e.g. Sashimi-grade salmon fillet" />
        <Field label="Category" name="category" as="select" defaultValue="produce">
          {CATEGORIES.filter(([id]) => id !== "all").map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </Field>
        <Field label="Order frequency" name="defaultFrequency" as="select" defaultValue="weekly">
          <option value="daily">Daily — ordered each morning</option>
          <option value="weekly">Weekly — Monday standing order</option>
          <option value="monthly">Monthly — bulk / pantry stock</option>
          <option value="adhoc">Ad hoc — per menu requirement</option>
        </Field>
        <Field
          label="Stock unit *"
          name="defaultUnit"
          required
          defaultValue="kg"
          hint="kg, g, L, ml, pcs, bunch…"
        />
        <Field label="Preferred vendor" name="vendorId" as="select" defaultValue="">
          <option value="">— unassigned —</option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
          ))}
        </Field>
        <Field label="Purchase unit" name="purchaseUnit" placeholder="Defaults to the stock unit" />
        <Field label="Unit cost (₹)" name="unitCost" type="number" min="0" step="0.01" />
        <Field label="Status" name="status" as="select" defaultValue="needed">
          {STATUSES.map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </Field>
        <Field label="Standing qty needed" name="quantityNeeded" type="number" min="0" step="0.001" defaultValue="0" />
        <Field label="Par level" name="parLevel" type="number" min="0" step="0.001" defaultValue="0" hint="Minimum stock to hold" />
        <Field label="Opening stock" name="quantity" type="number" min="0" step="0.001" defaultValue="0" />
        <Field
          label="Specification / chef notes"
          name="notes"
          as="textarea"
          full
          placeholder="e.g. Sashimi-grade, frozen at −20°C for 24hr. Day-boat only."
        />
      </div>
    </Modal>
  );
}

export function VendorModal({
  vendor,
  saving,
  onClose,
  onSave,
}: {
  vendor?: Vendor | null;
  saving: boolean;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => void;
}) {
  return (
    <Modal
      title={vendor ? `Edit ${vendor.name}` : "Add Vendor"}
      onClose={onClose}
      saving={saving}
      onSubmit={(form) => {
        const data = Object.fromEntries(new FormData(form).entries());
        onSave(data);
      }}
    >
      <div className="form-grid">
        <Field label="Vendor name *" name="name" required full defaultValue={vendor?.name} placeholder="e.g. Russel Market — Fish & Seafood" />
        <Field label="Category" name="category" defaultValue={vendor?.category ?? ""} placeholder="protein / produce / pantry…" />
        <Field label="Contact person" name="contact" defaultValue={vendor?.contact ?? ""} placeholder="Name to ask for" />
        <Field label="WhatsApp" name="whatsapp" defaultValue={vendor?.whatsapp ?? ""} placeholder="+91 98xxx xxxxx" />
        <Field label="Phone" name="phone" defaultValue={vendor?.phone ?? ""} />
        <Field label="Email" name="email" type="email" defaultValue={vendor?.email ?? ""} />
        <Field label="Minimum order" name="minimumOrder" defaultValue={vendor?.minimumOrder ?? ""} placeholder="₹500 min" />
        <Field label="Lead time" name="leadTime" defaultValue={vendor?.leadTime ?? ""} placeholder="Same-day by 6am" />
        <Field label="Order cut-off" name="cutoff" defaultValue={vendor?.cutoff ?? ""} placeholder="Order by 9pm" />
        <Field label="Delivery area" name="area" defaultValue={vendor?.area ?? ""} placeholder="Sadashivnagar" />
        <Field label="Payment terms" name="paymentTerms" defaultValue={vendor?.paymentTerms ?? ""} placeholder="COD / UPI" />
        <Field label="Notes & tips" name="notes" as="textarea" full defaultValue={vendor?.notes ?? ""} />
      </div>
    </Modal>
  );
}

export function VesselModal({
  saving,
  onClose,
  onSave,
}: {
  saving: boolean;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => void;
}) {
  return (
    <Modal
      title="Register Vessel Kit"
      onClose={onClose}
      saving={saving}
      onSubmit={(form) => {
        const data = new FormData(form);
        onSave({
          subscriberName: data.get("subscriberName"),
          type: data.get("type"),
          status: data.get("status"),
          sets: Number(data.get("sets")),
          issuedAt: data.get("issuedAt") || undefined,
          sanitisedAt: data.get("sanitisedAt") || undefined,
          notes: data.get("notes") || undefined,
        });
      }}
    >
      <div className="form-grid">
        <Field label="Subscriber name *" name="subscriberName" required full placeholder="Full name" />
        <Field label="Vessel type" name="type" as="select" defaultValue="steel">
          <option value="steel">Stainless steel (18/8)</option>
          <option value="copper">Copper (tin-lined)</option>
        </Field>
        <Field label="Kit status" name="status" as="select" defaultValue="active">
          <option value="active">Active — in rotation</option>
          <option value="needs-replace">Needs replacement</option>
          <option value="retired">Retired / unsubscribed</option>
        </Field>
        <Field label="Sets in circulation" name="sets" as="select" defaultValue="2">
          <option value="2">2 sets (standard)</option>
          <option value="1">1 set (temporary)</option>
        </Field>
        <Field label="Issued date" name="issuedAt" type="date" />
        <Field label="Last sanitisation" name="sanitisedAt" type="date" />
        <Field label="Notes" name="notes" as="textarea" full placeholder="Repair or delivery notes…" />
      </div>
    </Modal>
  );
}

/**
 * Stock movement. Replaces the old "Receive" button that hardcoded a quantity
 * of 1 regardless of what was actually delivered.
 */
export function MovementModal({
  ingredient,
  saving,
  onClose,
  onSave,
}: {
  ingredient: Ingredient;
  saving: boolean;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => void;
}) {
  const [type, setType] = useState("RECEIVE");
  const needsReason = type === "WASTE" || type === "ADJUST";

  return (
    <Modal
      title={`Stock movement — ${ingredient.name}`}
      subtitle={`On hand: ${ingredient.quantity} ${ingredient.defaultUnit} · par ${ingredient.parLevel}`}
      onClose={onClose}
      saving={saving}
      submitLabel="Record movement"
      onSubmit={(form) => {
        const data = new FormData(form);
        onSave({
          ingredientId: ingredient.id,
          type: data.get("type"),
          quantity: Number(data.get("quantity")),
          unit: data.get("unit") || undefined,
          unitCost: data.get("unitCost") ? Number(data.get("unitCost")) : undefined,
          reason: data.get("reason") || undefined,
          reference: data.get("reference") || undefined,
        });
      }}
    >
      <div className="form-grid">
        <Field
          label="Movement type"
          name="type"
          as="select"
          value={type}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setType(event.target.value)}
        >
          <option value="RECEIVE">Receive — goods arrived</option>
          <option value="CONSUME">Consume — used in production</option>
          <option value="WASTE">Waste — spoiled or discarded</option>
          <option value="RETURN">Return — back into stock</option>
          <option value="ADJUST">Adjust — correct to a counted balance</option>
        </Field>
        <Field
          label={type === "ADJUST" ? "Counted balance *" : "Quantity *"}
          name="quantity"
          type="number"
          min="0"
          step="0.001"
          required
          defaultValue={type === "RECEIVE" ? ingredient.reorderQuantity || "" : ""}
          hint={type === "ADJUST" ? "The balance becomes exactly this." : "A magnitude — direction comes from the type."}
        />
        <Field label="Unit" name="unit" defaultValue={ingredient.defaultUnit} hint="Converted to the stock unit." />
        <Field label="Unit cost (₹)" name="unitCost" type="number" min="0" step="0.01" />
        <Field
          label={needsReason ? "Reason *" : "Reason"}
          name="reason"
          required={needsReason}
          full
          placeholder={needsReason ? "Required for waste and adjustments" : "Optional"}
        />
        <Field label="Reference" name="reference" full placeholder="Invoice number, production run…" />
      </div>
    </Modal>
  );
}

/** BR-13 — records per-line receipt, which writes RECEIVE movements. */
export function ReceiveOrderModal({
  order,
  saving,
  onClose,
  onSave,
}: {
  order: PurchaseOrder;
  saving: boolean;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => void;
}) {
  return (
    <Modal
      title={`Receive from ${order.vendor.name}`}
      subtitle="Recording receipt creates stock movements for each line."
      onClose={onClose}
      saving={saving}
      submitLabel="Record receipt"
      wide
      onSubmit={(form) => {
        const data = new FormData(form);
        const lines = order.lines
          .map((line) => ({ lineId: line.id, receivedQty: Number(data.get(`qty-${line.id}`) ?? 0) }))
          .filter((line) => line.receivedQty > 0);
        onSave({ lines, reference: data.get("reference") || undefined });
      }}
    >
      <table className="inventory-table">
        <thead>
          <tr><th>Ingredient</th><th>Ordered</th><th>Already received</th><th>Receiving now</th></tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.id}>
              <td><strong>{line.ingredientName}</strong></td>
              <td>{line.requestedQty} {line.unit}</td>
              <td>{line.receivedQty} {line.unit}</td>
              <td>
                <input
                  className="inline-input"
                  name={`qty-${line.id}`}
                  type="number"
                  min="0"
                  step="0.001"
                  defaultValue={line.outstandingQty || ""}
                />{" "}
                {line.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-grid">
        <Field label="Delivery reference" name="reference" full placeholder="Invoice or challan number" />
      </div>
    </Modal>
  );
}
