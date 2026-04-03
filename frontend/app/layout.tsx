"use client";

import "./globals.css";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const syncLoginState = () => {
      setIsLoggedIn(localStorage.getItem("grnscope-demo-login") === "true");
    };

    syncLoginState();
    window.addEventListener("storage", syncLoginState);

    return () => {
      window.removeEventListener("storage", syncLoginState);
    };
  }, []);

  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/80 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-10">
            <Link href="/" className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-teal-400/20 text-lg font-semibold text-teal-300 ring-1 ring-teal-300/30">
                G
              </div>
              <div>
                <p className="text-lg font-semibold tracking-tight text-white">
                  GRN Scope
                </p>
                <p className="text-sm text-slate-400">
                  Gene regulatory network analysis platform
                </p>
              </div>
            </Link>

            <nav>
              <Link
                href={isLoggedIn ? "/projects" : "/login"}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm text-slate-300 transition hover:border-white/30 hover:bg-white/5 hover:text-white"
              >
                {isLoggedIn && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className="h-4 w-4"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 10.5L12 3.75l8.25 6.75"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5.25 9.75V19.5h13.5V9.75"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.75 19.5v-4.5h4.5v4.5"
                    />
                  </svg>
                )}
                {isLoggedIn ? "Home" : "Log in"}
              </Link>
            </nav>
          </div>
        </header>

        {children}
      </body>
    </html>
  );
}