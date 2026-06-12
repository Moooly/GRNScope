"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import { apiFetch } from "./_lib/clientIdentity";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";

export type ContactSupportContext = {
  question?: string;
  pageUrl?: string;
  projectId?: string;
  algorithmId?: string;
};

type ContactSupportModalProps = {
  open: boolean;
  context: ContactSupportContext;
  onClose: () => void;
};

export default function ContactSupportModal({
  open,
  context,
  onClose,
}: ContactSupportModalProps) {
  const [question, setQuestion] = useState("");
  const [replyToEmail, setReplyToEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;

    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    setIsClosing(false);
    setQuestion(context.question || "");
    setReplyToEmail("");
    setStatus("idle");
    setErrorMessage("");
  }, [context, open]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  if (!open) return null;

  function requestClose() {
    if (isClosing) return;

    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setIsClosing(false);
      onClose();
    }, 480);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      setStatus("error");
      setErrorMessage("Please describe the question.");
      return;
    }

    setStatus("sending");
    setErrorMessage("");

    try {
      const response = await apiFetch(`${API_BASE}/contact`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: trimmedQuestion,
          reply_to_email: replyToEmail.trim() || null,
          page_url:
            context.pageUrl ||
            (typeof window !== "undefined" ? window.location.href : null),
          project_id: context.projectId || null,
          algorithm_id: context.algorithmId || null,
        }),
      });

      if (!response.ok) {
        let detail = "GRNScope could not send the message. Please try again later.";
        try {
          const payload = await response.json();
          if (typeof payload?.detail === "string") {
            detail = payload.detail;
          }
        } catch {
          // Keep the friendly fallback.
        }
        throw new Error(detail);
      }

      setStatus("sent");
      setQuestion("");
      setReplyToEmail("");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "GRNScope could not send the message.");
    }
  }

  return (
    <div
      className={`fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 px-6 py-10 backdrop-blur-sm ${
        isClosing ? "animate-modal-overlay-out" : "animate-modal-overlay"
      }`}
      onClick={requestClose}
    >
      <div
        className={`w-full max-w-lg rounded-[1.75rem] border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/20 ${
          isClosing ? "animate-modal-panel-out" : "animate-modal-panel"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#1b75a6]">
              Contact
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
              Tell us what happened
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Describe the question or error you encountered. The current page will be included automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-lg font-bold text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
            aria-label="Close contact form"
          >
            ×
          </button>
        </div>

        {status === "sent" ? (
          <div className="mt-6 rounded-[1.25rem] border border-emerald-100 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">
            Message sent. We will review it soon.
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                Your question
              </span>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={6}
                maxLength={4000}
                className="mt-2 w-full resize-y rounded-[1.1rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1b75a6] focus:bg-white focus:ring-4 focus:ring-sky-100"
                placeholder="Describe the problem, what you expected, or what you need help with."
              />
            </label>

            <label className="block">
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                Email for reply (optional)
              </span>
              <input
                value={replyToEmail}
                onChange={(event) => setReplyToEmail(event.target.value)}
                type="email"
                className="mt-2 w-full rounded-[1.1rem] border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1b75a6] focus:ring-4 focus:ring-sky-100"
                placeholder="name@example.com"
              />
            </label>

            {status === "error" && (
              <p className="rounded-[1rem] border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {errorMessage}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={requestClose}
                className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={status === "sending"}
                className="rounded-full bg-[#1b75a6] px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-sky-900/15 transition hover:bg-[#16638f] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "sending" ? "Sending..." : "Send message"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
