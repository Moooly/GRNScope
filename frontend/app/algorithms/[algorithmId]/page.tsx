"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  type AlgorithmEntry,
  fetchAlgorithmById,
  formatParameterDefault,
  formatParameterRange,
} from "../_lib/catalog";

export default function AlgorithmDetailPage() {
  const params = useParams<{ algorithmId: string }>();
  const algorithmId = useMemo(() => {
    try {
      return decodeURIComponent(params.algorithmId).trim().toUpperCase();
    } catch {
      return params.algorithmId.trim().toUpperCase();
    }
  }, [params.algorithmId]);
  const [result, setResult] = useState<{
    algorithmId: string;
    algorithm: AlgorithmEntry | null;
    error: string | null;
  }>({ algorithmId: "", algorithm: null, error: null });

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [algorithmId]);

  useEffect(() => {
    const controller = new AbortController();

    fetchAlgorithmById(algorithmId, controller.signal)
      .then((algorithm) => {
        setResult({ algorithmId, algorithm, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          algorithmId,
          algorithm: null,
          error: error instanceof Error ? error.message : "Failed to load algorithm.",
        });
      });

    return () => controller.abort();
  }, [algorithmId]);

  const isLoading = result.algorithmId !== algorithmId;
  const algorithm = isLoading ? null : result.algorithm;
  const loadError = isLoading ? null : result.error;

  if (isLoading) return <AlgorithmDetailLoading />;

  if (loadError || !algorithm) {
    return (
      <main className="min-h-screen bg-[#f7fbff] px-6 py-16 text-slate-900">
        <div className="mx-auto max-w-2xl rounded-[1.5rem] border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#1b75a6]">Algorithms directory</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Algorithm unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {loadError ?? "This algorithm could not be found."}
          </p>
          <Link
            href="/algorithms"
            className="mt-6 inline-flex h-10 items-center rounded-full bg-[#1b75a6] px-5 text-sm font-bold text-white transition hover:bg-[#155f87]"
          >
            Back to algorithms
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7fbff] text-slate-900">
      <section className="border-b border-slate-200 bg-white/55">
        <div className="mx-auto max-w-[1100px] px-6 py-8 lg:px-10 lg:py-10">
          <Link
            href="/algorithms"
            className="group inline-flex items-center gap-2 text-sm font-semibold text-slate-500 transition hover:text-[#1b75a6]"
          >
            <span aria-hidden="true" className="transition group-hover:-translate-x-0.5">←</span>
            All algorithms
          </Link>

          <div className="mt-7 max-w-3xl">
            <p className="text-sm font-medium text-[#1b75a6]">{algorithm.category}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
                {algorithm.name}
              </h1>
              {algorithm.recommended ? (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-700">
                  Recommended
                </span>
              ) : null}
            </div>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
              {algorithm.tagline}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <PropertyPill>{algorithm.requiresPseudotime ? "Uses pseudotime" : "No pseudotime"}</PropertyPill>
              <PropertyPill>{algorithm.directed ? "Directed" : "Undirected"}</PropertyPill>
              <PropertyPill>{algorithm.signed ? "Signed" : "Unsigned"}</PropertyPill>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-[1100px] gap-10 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-14 lg:px-10 lg:py-12">
        <div>
          <section className="border-b border-slate-200 pb-9">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1b75a6]">Overview</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">How the method works</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">{algorithm.detail}</p>
          </section>

          <div className="grid gap-10 border-b border-slate-200 py-9 md:grid-cols-2">
            <InsightSection title="Strengths" tone="positive" items={algorithm.strengths} />
            <InsightSection title="Limitations" tone="caution" items={algorithm.limitations} />
          </div>

          <section className="pt-9">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1b75a6]">Configuration</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Parameters</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Defaults used by GRNScope when this method is selected.
            </p>

            {algorithm.parameters.length > 0 ? (
              <div className="mt-5 divide-y divide-slate-200 border-y border-slate-200">
                {algorithm.parameters.map((parameter) => {
                  const range = formatParameterRange(parameter);
                  return (
                    <div key={parameter.name} className="py-5 first:pt-4 last:pb-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="text-sm font-bold text-slate-950">
                            {parameter.label ?? parameter.name}
                          </h3>
                          {parameter.description ? (
                            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                              {parameter.description}
                            </p>
                          ) : null}
                        </div>
                        <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                          Default: {formatParameterDefault(parameter)}
                        </span>
                      </div>
                      {range ? <p className="mt-2 text-xs font-medium text-slate-400">{range}</p> : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                No adjustable parameters—this method runs with platform defaults.
              </div>
            )}
          </section>
        </div>

        <aside className="self-start lg:sticky lg:top-[calc(var(--grnscope-header-height)+1.5rem)]">
          <section className="rounded-2xl bg-[#f1f6f8] p-6">
            <h2 className="text-lg font-semibold text-slate-950">At a glance</h2>
            <dl className="mt-4 divide-y divide-[#1b75a6]/10">
              <DetailRow label="Methodology" value={algorithm.category} />
              <DetailRow label="Published" value={algorithm.year} />
              <DetailRow label="Journal" value={algorithm.journal || "—"} />
              <DetailRow label="Input" value={algorithm.requiresPseudotime ? "Expression + pseudotime" : "Expression matrix"} />
              <DetailRow label="Output" value={`${algorithm.directed ? "Directed" : "Undirected"} · ${algorithm.signed ? "Signed" : "Unsigned"}`} />
            </dl>

            <div className="mt-5 grid gap-2">
              <ExternalLink href={algorithm.paperUrl}>Open paper</ExternalLink>
              {algorithm.sourceUrl ? <ExternalLink href={algorithm.sourceUrl}>View source code</ExternalLink> : null}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function PropertyPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-[#e9f2f6] px-3 py-1.5 text-xs font-medium text-slate-600">
      {children}
    </span>
  );
}

function InsightSection({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "positive" | "caution";
  items: string[];
}) {
  const markerClass = tone === "positive" ? "bg-emerald-500" : "bg-amber-500";
  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight text-slate-950">{title}</h2>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-sm leading-6 text-slate-600">
            <span aria-hidden="true" className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${markerClass}`} />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-3 first:pt-0 last:pb-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</dt>
      <dd className="text-sm font-medium leading-5 text-slate-700">{value}</dd>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group inline-flex h-9 items-center justify-between border-b border-[#1b75a6]/15 text-sm font-medium text-slate-700 transition hover:border-[#1b75a6]/40 hover:text-[#1b75a6]"
    >
      {children}
      <span aria-hidden="true" className="text-slate-400 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5">↗</span>
    </a>
  );
}

function AlgorithmDetailLoading() {
  return (
    <main className="min-h-screen animate-pulse bg-[#f7fbff]">
      <div className="border-b border-slate-200 bg-white/55">
        <div className="mx-auto max-w-[1100px] px-6 py-10 lg:px-10">
          <div className="h-4 w-28 rounded-full bg-slate-200" />
          <div className="mt-7 h-5 w-36 rounded-full bg-slate-200" />
          <div className="mt-4 h-12 w-64 rounded-2xl bg-slate-200" />
          <div className="mt-5 h-5 max-w-2xl rounded-full bg-slate-100" />
        </div>
      </div>
      <div className="mx-auto grid max-w-[1100px] gap-10 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-14 lg:px-10">
        <div className="h-80 border-y border-slate-200" />
        <div className="h-96 rounded-2xl bg-[#f1f6f8]" />
      </div>
    </main>
  );
}
