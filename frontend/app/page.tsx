"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CreateProjectFlow from "./projects/_components/CreateProjectFlow";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

export default function HomePage() {
  const [isCreateVisible, setIsCreateVisible] = useState(false);

  const router = useRouter();

  const openCreateModal = () => {
    setIsCreateVisible(true);
  };

  const closeCreateModal = () => {
    setIsCreateVisible(false);
  };

  return (
    <main className="min-h-screen bg-[#f7fbff] text-slate-900">
      {/* Hero */}
      <section className="relative overflow-hidden bg-[#f4f6f8]">
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/90 to-transparent" />
        <div className="absolute -left-24 top-28 h-72 w-72 rounded-full bg-cyan-100/60 blur-3xl" />
        <div className="absolute -right-24 top-20 h-72 w-72 rounded-full bg-teal-100/60 blur-3xl" />

        <div className="relative mx-auto max-w-[1180px] px-6 pb-10 pt-16 lg:px-10 lg:pb-12 lg:pt-18">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_0.55fr] lg:items-center">
            <div className="max-w-none">
              <p className="mb-4 text-sm font-bold uppercase tracking-[0.28em] text-[#1b75a6]">
                Gene regulatory network analysis
              </p>

              <h1 className="text-5xl font-bold tracking-tight text-slate-950 sm:text-6xl lg:text-[4.15rem] lg:leading-[1.02]">
                GRNScope
              </h1>

              <div className="mt-6 max-w-4xl text-[1.05rem] leading-8 text-slate-700">
                <p>
                  GRNScope turns single-cell RNA-seq expression matrices into predicted gene regulatory networks. It runs multiple inference algorithms, compares ranked edges, and provides interactive results for network inspection and export.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={openCreateModal}
              className="group w-full rounded-[1.75rem] border border-slate-200 bg-[#f7fbff] p-6 text-left transition hover:-translate-y-0.5 hover:border-[#1b75a6]/30 hover:shadow-md"
            >
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#1b75a6]">
                Direct start
              </p>
              <h3 className="mt-3 text-xl font-bold tracking-tight text-slate-950">
                Start a new GRN analysis
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Upload an expression matrix and start a new analysis directly.
              </p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-[#1b75a6] transition group-hover:gap-2.5">
                Upload matrix
                <span aria-hidden="true">→</span>
              </span>
            </button>
          </div>
        </div>
      </section>

      
      <CreateProjectFlow
        open={isCreateVisible}
        onClose={closeCreateModal}
        onProjectCreated={() => {
          router.push("/projects");
        }}
      />
    </main>
  );
}
