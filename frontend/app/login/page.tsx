import Link from "next/link";

export default function LoginPage() {
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
              Log in
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Access your GRNScope workspace
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-300">
              Sign in to manage projects, upload datasets, monitor algorithm
              jobs, and explore consensus network results.
            </p>

            <div className="mt-10 space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <p className="text-sm font-medium text-white">Project dashboard</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  View your existing projects, uploaded datasets, and submitted
                  analysis jobs.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <p className="text-sm font-medium text-white">Analysis tracking</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Follow job status, inspect partial results, and compare
                  individual algorithms with consensus outputs.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-8 shadow-2xl shadow-cyan-950/20">
            <div className="mx-auto max-w-md">
              <h2 className="text-2xl font-semibold text-white">Welcome back</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                This is the frontend login page. Later, this form will connect to
                your FastAPI backend login endpoint.
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
                    placeholder="Enter your password"
                    className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300/40"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full rounded-2xl bg-teal-400 px-6 py-3 text-sm font-medium text-slate-950 transition hover:bg-teal-300"
                >
                  Log in
                </button>
              </form>

              <p className="mt-6 text-sm text-slate-400">
                Don&apos;t have an account?{" "}
                <Link
                  href="/register"
                  className="font-medium text-teal-300 transition hover:text-teal-200"
                >
                  Create one
                </Link>
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}