"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/api-client";
import { inr, type GenerationResult, type Outreach, type PurchaseOrder } from "./types";

/**
 * Vendor outreach and purchase orders.
 *
 * Uses the server's outreach endpoint rather than rebuilding a message client
 * side, so the full prototype template and the wa.me deep link come back
 * intact. Also surfaces what generation refused to guess at — unsourced items
 * and unconvertible units — which the previous version discarded silently.
 */
export function OutreachPanel({
  orders,
  week,
  weekCount,
  generation,
  busy,
  onWeekChange,
  onGenerate,
  onTransition,
  onReceive,
  onError,
}: {
  orders: PurchaseOrder[];
  week: number;
  weekCount: number;
  generation: GenerationResult | null;
  busy: boolean;
  onWeekChange: (week: number) => void;
  onGenerate: () => void;
  onTransition: (order: PurchaseOrder, status: string) => void;
  onReceive: (order: PurchaseOrder) => void;
  onError: (message: string) => void;
}) {
  const [outreach, setOutreach] = useState<Record<string, Outreach>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function loadOutreach(orderId: string) {
    if (outreach[orderId]) {
      setExpanded(expanded === orderId ? null : orderId);
      return;
    }
    try {
      const message = await api.get<Outreach>(`/purchase-orders/${orderId}/outreach`);
      setOutreach((current) => ({ ...current, [orderId]: message }));
      setExpanded(orderId);
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  async function copy(orderId: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(orderId);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      onError("Could not copy to the clipboard.");
    }
  }

  return (
    <>
      <div className="outreach-note">
        Purchase requirements are computed from the week&apos;s recipe demand minus current stock, grouped by each
        ingredient&apos;s preferred vendor. Generating is idempotent — re-running reconciles rather than duplicating,
        and never rewrites an order already sent.
      </div>

      <section className="inventory-card">
        <div className="card-toolbar">
          <h2>Vendor Outreach</h2>
          <div className="week-select">
            {Array.from({ length: weekCount }, (_, index) => index + 1).map((item) => (
              <button key={item} className={week === item ? "selected" : ""} onClick={() => onWeekChange(item)}>
                Week {item}
              </button>
            ))}
            <button className="btn btn-copper btn-small" onClick={onGenerate} disabled={busy}>
              {busy ? "Generating…" : "Generate orders"}
            </button>
          </div>
        </div>

        {generation && <GenerationReport result={generation} />}

        {orders.length === 0 && (
          <div className="cost-summary">No purchase orders for this week yet. Generate them above.</div>
        )}

        {orders.map((order) => {
          const message = outreach[order.id];
          const isOpen = expanded === order.id;

          return (
            <article className="outreach-card" key={order.id}>
              <div className="outreach-head">
                <div>
                  <div className="outreach-name">{order.vendor.name}</div>
                  <div className="outreach-meta">
                    {order.lineCount} line{order.lineCount === 1 ? "" : "s"} · {inr(order.estimatedCost)} ·{" "}
                    <span className={`po-status po-${order.status.toLowerCase()}`}>{order.status.replace("_", " ")}</span>
                    {order.vendor.leadTime && ` · ${order.vendor.leadTime}`}
                  </div>
                </div>
                <button className="btn btn-ghost btn-small" onClick={() => void loadOutreach(order.id)}>
                  {isOpen ? "Hide message" : "Show message"}
                </button>
              </div>

              <div className="outreach-items">
                {order.lines.map((line) => (
                  <div className="outreach-item-row" key={line.id}>
                    <span>
                      {line.ingredientName} — {line.requestedQty} {line.unit}
                      {line.receivedQty > 0 && (
                        <em className="cell-muted"> · received {line.receivedQty}, outstanding {line.outstandingQty}</em>
                      )}
                    </span>
                    <span className="cell-muted">{line.lineCost === null ? "—" : inr(line.lineCost)}</span>
                  </div>
                ))}
              </div>

              {isOpen && message && (
                <div className="outreach-body visible">
                  <pre className="outreach-msg">{message.message}</pre>
                  <div className="order-actions">
                    <button className="btn btn-ghost btn-small" onClick={() => void copy(order.id, message.message)}>
                      {copied === order.id ? "✓ Copied" : "Copy message"}
                    </button>
                    {message.whatsappUrl && (
                      <a className="btn btn-green btn-small" href={message.whatsappUrl} target="_blank" rel="noreferrer">
                        📱 Send on WhatsApp
                      </a>
                    )}
                  </div>
                </div>
              )}

              <div className="order-actions">
                {order.allowedTransitions
                  .filter((status) => status !== "RECEIVED" && status !== "PARTIALLY_RECEIVED")
                  .map((status) => (
                    <button
                      key={status}
                      className="btn btn-ghost btn-small"
                      onClick={() => onTransition(order, status)}
                    >
                      Mark {status.toLowerCase().replace("_", " ")}
                    </button>
                  ))}
                {["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status) && (
                  <button className="btn btn-copper btn-small" onClick={() => onReceive(order)}>
                    Receive goods
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </>
  );
}

/** What generation could not do, made visible rather than swallowed. */
function GenerationReport({ result }: { result: GenerationResult }) {
  if (!result.unsourced.length && !result.exceptions.length && !result.skipped.length) return null;

  return (
    <div className="generation-report">
      {result.skipped.length > 0 && (
        <div className="inventory-note">
          <strong>{result.skipped.length} order(s) left untouched</strong> because they have already been sent:{" "}
          {result.skipped.map((item) => `${item.vendorName} (${item.status.toLowerCase()})`).join(", ")}.
        </div>
      )}

      {result.unsourced.length > 0 && (
        <details className="exception-block">
          <summary>
            ⚠ {result.unsourced.length} ingredient(s) needed but no preferred vendor is set
          </summary>
          <ul>
            {result.unsourced.slice(0, 40).map((line) => (
              <li key={line.ingredientId}>
                {line.ingredientName} — {line.requestedQty} {line.unit}
              </li>
            ))}
            {result.unsourced.length > 40 && <li>…and {result.unsourced.length - 40} more</li>}
          </ul>
          <small>Assign a preferred vendor on the ingredient to include these in a purchase order.</small>
        </details>
      )}

      {result.exceptions.length > 0 && (
        <details className="exception-block">
          <summary>⚠ {result.exceptions.length} quantity/unit mismatch(es)</summary>
          <ul>
            {result.exceptions.map((item, index) => (
              <li key={`${item.ingredientName}-${index}`}>
                {item.ingredientName}: recipe uses <code>{item.from}</code> but stock is held in{" "}
                <code>{item.to}</code> — {item.quantity} {item.from} could not be converted.
              </li>
            ))}
          </ul>
          <small>
            These are not guessed at. Fix the recipe unit or the ingredient&apos;s stock unit so the two are
            comparable.
          </small>
        </details>
      )}
    </div>
  );
}
