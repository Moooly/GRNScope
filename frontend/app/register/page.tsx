import Link from "next/link";

export default function RegisterPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-7xl items-center px-6 py-16 lg:px-10">
        <div className="grid w-full gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="flex flex-col justify-center">
            <Link
              href="/"
              className="mb-8 inline-flex w-fit items-center gap-2 text-sm text-slate-400 transition hover:text-white"
            >
              ← Back to home
            </Link>

            <p className="text-sm font-medium uppercase tracking-[0.22em] text-teal-300">
              Get started
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Create your GRNScope account
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-300">
              Register to create projects, upload expression matrices, select
              inference algorithms, and review network results in one workspace.
            </p>

            <div className="mt-10 grid gap-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <p className="text-sm font-medium text-white">Persistent projects</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Save datasets, jobs, and outputs inside your own project
                  dashboard.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <p className="text-sm font-medium text-white">Asynchronous analysis</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Submit multiple algorithms and return later to inspect status
                  and results.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-8 shadow-2xl shadow-cyan-950/20">
            <div className="mx-auto max-w-md">
              <h2 className="text-2xl font-semibold text-white">Create account</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                This is the frontend registration page. Later, this form will
                connect to your FastAPI register endpoint and redirect to the
                dashboard after success.
              </p>

              <form className="mt-8 space-y-5">
                <div>
                  <label
                    htmlFor="email"
                    className="mb-2 block text-sm font-medium text-slate-200"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    placeholder="name@example.com"
                    className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300/40"
                  />
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="mb-2 block text-sm font-medium text-slate-200"
                  >
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    placeholder="At least 8 characters"
                    className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300/40"
                  />
                </div>

                <div>
                  <label
                    htmlFor="confirmPassword"
                    className="mb-2 block text-sm font-medium text-slate-200"
                  >
                    Confirm password
                  </label>
                  <input
                    id="confirmPassword"
                    type="password"
                    placeholder="Re-enter your password"
                    className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300/40"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full rounded-2xl bg-teal-400 px-6 py-3 text-sm font-medium text-slate-950 transition hover:bg-teal-300"
                >
                  Create account
                </button>
              </form>

              <p className="mt-6 text-sm text-slate-400">
                Already have an account?{" "}
                <Link
                  href="/login"
                  className="font-medium text-teal-300 transition hover:text-teal-200"
                >
                  Log in
                </Link>
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}