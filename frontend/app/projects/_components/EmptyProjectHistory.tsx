export default function EmptyProjectHistory() {
  return (
    <div className="mt-8 rounded-[2rem] border border-white/10 bg-white/[0.03] p-10 text-center">
      <p className="text-sm font-medium uppercase tracking-[0.22em] text-teal-300">
        No project history
      </p>
      <h3 className="mt-4 text-2xl font-semibold text-white">
        You have not created any projects yet.
      </h3>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        Create your first project to upload a dataset, configure preprocessing,
        and start GRN analysis.
      </p>
    </div>
  );
}