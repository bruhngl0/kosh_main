"use client";

import { useCallback, useEffect, useState } from "react";

export type Feedback = { tone: "ok" | "error"; text: string } | null;

/**
 * Transient feedback for mutations.
 *
 * Errors persist until dismissed; successes clear themselves. Previously every
 * component kept a bare `message` string that never distinguished a failure
 * from a success, so a rejected save looked identical to a completed one.
 */
export function useFeedback(successTimeoutMs = 4000) {
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (feedback?.tone !== "ok") return;
    const timer = window.setTimeout(() => setFeedback(null), successTimeoutMs);
    return () => window.clearTimeout(timer);
  }, [feedback, successTimeoutMs]);

  const succeed = useCallback((text: string) => setFeedback({ tone: "ok", text }), []);
  const fail = useCallback((text: string) => setFeedback({ tone: "error", text }), []);
  const clear = useCallback(() => setFeedback(null), []);

  return { feedback, succeed, fail, clear };
}

export function ActionMessage({ feedback, onDismiss }: { feedback: Feedback; onDismiss: () => void }) {
  if (!feedback) return null;
  return (
    <div
      className={`action-message ${feedback.tone === "ok" ? "success-box" : "error-box"}`}
      role={feedback.tone === "error" ? "alert" : "status"}
    >
      <span>{feedback.text}</span>
      <button type="button" className="modal-close" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
