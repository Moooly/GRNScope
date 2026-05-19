export default function EmptyProjectHistory() {
  return (
    <div className="mt-8 rounded-xl border border-slate-200 bg-white px-6 py-7 text-center text-slate-900 shadow-sm">
      <h3 className="text-lg font-bold tracking-tight text-slate-950">
        No projects yet
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
        Create a project to start analyzing a dataset.
      </p>
    </div>
  );
}
