"use client";

import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  const handleDemoLogin = () => {
    localStorage.setItem("grnscope-demo-login", "true");
    window.dispatchEvent(new Event("storage"));
    router.push("/");
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-73px)] max-w-3xl items-center px-6 py-16">
        <div className="w-full rounded-[2rem] border border-white/10 bg-white/[0.04] p-8 shadow-2xl shadow-cyan-950/20">
          <p className="text-sm font-medium uppercase tracking-[0.22em] text-teal-300">
            Log in
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">
            Temporary demo login
          </h1>
          <p className="mt-6 text-base leading-7 text-slate-300">
            Real authentication is not connected yet. Clicking the button below
            will simulate a successful login and switch the top bar button to
            Dashboard.
          </p>

          <button
            type="button"
            onClick={handleDemoLogin}
            className="mt-8 rounded-2xl bg-teal-400 px-6 py-3 text-sm font-medium text-slate-950 transition hover:bg-teal-300"
          >
            Log in
          </button>
        </div>
      </div>
    </main>
  );
}