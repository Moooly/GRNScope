export default function EmptyProjectHistory() {
  return (
    <div className="mt-8 rounded-[1.5rem] border border-slate-200 bg-white/95 p-10 text-center text-slate-900 shadow-sm">
      <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#1b75a6]">
        No project history
      </p>
      <h3 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">
        You have not created any projects yet.
      </h3>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600">
        Create your first project to upload a dataset, configure preprocessing,
        run GRN inference algorithms, and explore network results.
      </p>
    </div>
  );
}