export default function Loading() {
  return (
    <main className="min-h-[calc(100vh-var(--grnscope-header-height))] bg-[#f7fbff] text-slate-900">
      <section className="mx-auto max-w-[1180px] px-6 pb-10 pt-16 lg:px-10 lg:pb-12 lg:pt-18">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_0.55fr] lg:items-center">
          <div>
            <div className="h-4 w-72 animate-pulse rounded-full bg-[#1b75a6]/20" />
            <div className="mt-8 h-16 w-80 animate-pulse rounded-2xl bg-slate-200" />
            <div className="mt-8 max-w-3xl space-y-4">
              <div className="h-4 animate-pulse rounded-full bg-slate-200" />
              <div className="h-4 w-11/12 animate-pulse rounded-full bg-slate-200" />
              <div className="h-4 w-2/3 animate-pulse rounded-full bg-slate-200" />
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-slate-200 bg-[#f7fbff] p-6">
            <div className="h-3 w-36 animate-pulse rounded-full bg-[#1b75a6]/20" />
            <div className="mt-5 h-6 w-72 animate-pulse rounded-full bg-slate-200" />
            <div className="mt-6 space-y-3">
              <div className="h-4 animate-pulse rounded-full bg-slate-200" />
              <div className="h-4 w-4/5 animate-pulse rounded-full bg-slate-200" />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
