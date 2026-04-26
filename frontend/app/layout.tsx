"use client";

import "./globals.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeHeaderItem, setActiveHeaderItem] = useState<string | null>(null);

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

  useEffect(() => {
    if (pathname === "/") {
      setActiveHeaderItem("home");
      return;
    }

    if (pathname.startsWith("/algorithms")) {
      setActiveHeaderItem("algorithms");
      return;
    }

    if (pathname.startsWith("/projects") || pathname.startsWith("/login")) {
      setActiveHeaderItem("workspace");
    }
  }, [pathname]);

  const workspaceHref = isLoggedIn ? "/projects" : "/login";

  const navItemClass = (isActive: boolean) =>
    [
      "group inline-flex h-10 items-center gap-2.5 rounded-full px-3.5 text-[15px] font-semibold leading-none transition-all duration-200",
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#26c487]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#213f54]",
      isActive
        ? "bg-[#20b779]/12 text-[#24c684] shadow-sm shadow-slate-950/10 ring-1 ring-[#20b779]/20"
        : "text-[#b8c1c9] hover:bg-white/5 hover:text-white",
    ].join(" ");

  const navIconClass = "h-[19px] w-[19px] shrink-0";
  const isActive = (item: string) => activeHeaderItem === item;

  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-50 border-b border-[#1a3448] bg-[#213f54] shadow-[0_2px_10px_rgba(15,23,42,0.18)]">
          <div className="mx-auto flex h-[76px] w-full max-w-[1440px] items-center px-8 xl:px-14">
            <Link
              href="/"
              onClick={() => setActiveHeaderItem("home")}
              className="flex shrink-0 items-center gap-4"
              aria-label="Go to GRNScope home page"
            >
              <div className="relative flex h-[50px] w-[50px] items-center justify-center rounded-full border border-[#b08372] bg-[#213f54] shadow-inner shadow-slate-950/30 ring-2 ring-[#b08372]/50">
                <div className="absolute inset-[6px] rounded-full border border-slate-300/30" />
                <div className="absolute h-[30px] w-[30px] rounded-full border border-slate-400/30" />
                <span className="relative text-[19px] font-bold leading-none text-[#d8dde1]">
                  G
                </span>
              </div>
              <p className="text-[27px] font-medium tracking-[-0.045em] text-[#d8dde1]">
                GRNScope
              </p>
            </Link>

            <nav className="ml-auto flex items-center gap-2.5 xl:gap-4" aria-label="Primary navigation">
              <Link
                href="/"
                onClick={() => setActiveHeaderItem("home")}
                className={navItemClass(isActive("home"))}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={navIconClass}
                  aria-hidden="true"
                >
                  <path d="M12 3.172 3.172 12H5v8h5v-5h4v5h5v-8h1.828L12 3.172Z" />
                </svg>
                <span>Home</span>
              </Link>

              <Link
                href="/algorithms"
                onClick={() => setActiveHeaderItem("algorithms")}
                className={navItemClass(isActive("algorithms"))}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={navIconClass}
                  aria-hidden="true"
                >
                  <path d="M12 3C7.03 3 3 4.343 3 6v12c0 1.657 4.03 3 9 3s9-1.343 9-3V6c0-1.657-4.03-3-9-3Zm0 2c3.866 0 7 .895 7 2s-3.134 2-7 2-7-.895-7-2 3.134-2 7-2Zm7 5.1V14c0 1.105-3.134 2-7 2s-7-.895-7-2v-3.9C6.61 11.256 9.146 12 12 12s5.39-.744 7-1.9Zm0 6V18c0 1.105-3.134 2-7 2s-7-.895-7-2v-1.9C6.61 17.256 9.146 18 12 18s5.39-.744 7-1.9Z" />
                </svg>
                <span>Algorithms</span>
              </Link>

              <button
                type="button"
                onClick={() => setActiveHeaderItem("analysis")}
                className={navItemClass(isActive("analysis"))}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={navIconClass}
                  aria-hidden="true"
                >
                  <path d="M4.5 3.75A1.75 1.75 0 0 0 2.75 5.5v13A1.75 1.75 0 0 0 4.5 20.25h15a1.75 1.75 0 0 0 1.75-1.75v-13a1.75 1.75 0 0 0-1.75-1.75h-15Zm0 1.5h15a.25.25 0 0 1 .25.25v13a.25.25 0 0 1-.25.25h-15a.25.25 0 0 1-.25-.25v-13a.25.25 0 0 1 .25-.25Zm2.25 10.5h2.5v-5h-2.5v5Zm4 0h2.5v-8h-2.5v8Zm4 0h2.5v-3h-2.5v3Z" />
                </svg>
                <span>Analysis</span>
              </button>

              <Link
                href={workspaceHref}
                onClick={() => setActiveHeaderItem("workspace")}
                className={navItemClass(isActive("workspace"))}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={navIconClass}
                  aria-hidden="true"
                >
                  <path d="M6 5.75A1.75 1.75 0 0 1 7.75 4h8.5A1.75 1.75 0 0 1 18 5.75v12.5A1.75 1.75 0 0 1 16.25 20h-8.5A1.75 1.75 0 0 1 6 18.25V5.75Zm3 3.5a.75.75 0 0 0-1.5 0v6.5a.75.75 0 0 0 1.5 0v-6.5Zm3.75 3a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 1.5 0v-3.5Zm3.75-5a.75.75 0 0 0-1.5 0v8.5a.75.75 0 0 0 1.5 0v-8.5Z" />
                </svg>
                <span>Workspace</span>
              </Link>

              <button
                type="button"
                onClick={() => setActiveHeaderItem("download")}
                className={navItemClass(isActive("download"))}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={navIconClass}
                  aria-hidden="true"
                >
                  <path d="M12 3.75a.75.75 0 0 1 .75.75v8.69l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3.75 3.75a.75.75 0 0 1-1.06 0l-3.75-3.75a.75.75 0 1 1 1.06-1.06l2.47 2.47V4.5a.75.75 0 0 1 .75-.75ZM5.25 15a.75.75 0 0 1 .75.75v2.5h12v-2.5a.75.75 0 0 1 1.5 0V19A.75.75 0 0 1 18.75 19.75H5.25A.75.75 0 0 1 4.5 19v-3.25A.75.75 0 0 1 5.25 15Z" />
                </svg>
                <span>Download</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveHeaderItem("tutorial")}
                className={navItemClass(isActive("tutorial"))}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={navIconClass}
                  aria-hidden="true"
                >
                  <path d="M6 3.75A1.75 1.75 0 0 0 4.25 5.5v13A1.75 1.75 0 0 0 6 20.25h12a.75.75 0 0 0 0-1.5H6a.25.25 0 0 1-.25-.25V5.5A.25.25 0 0 1 6 5.25h9.25v4A1.75 1.75 0 0 0 17 11h3V5.5a1.75 1.75 0 0 0-1.75-1.75H6Zm10.75 1.56 2.44 2.44H17a.25.25 0 0 1-.25-.25V5.31ZM8 13.25a.75.75 0 0 0 0 1.5h8a.75.75 0 0 0 0-1.5H8Zm0 3a.75.75 0 0 0 0 1.5h6a.75.75 0 0 0 0-1.5H8Z" />
                </svg>
                <span>Tutorial</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveHeaderItem("contact")}
                className={navItemClass(isActive("contact"))}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={navIconClass}
                  aria-hidden="true"
                >
                  <path d="M12 2.75a9.25 9.25 0 1 0 0 18.5 9.25 9.25 0 0 0 0-18.5Zm0 4.25a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 12.75a7.72 7.72 0 0 1-5.77-2.59A6.74 6.74 0 0 1 12 14.25a6.74 6.74 0 0 1 5.77 2.91A7.72 7.72 0 0 1 12 19.75Z" />
                </svg>
                <span>Contact us</span>
              </button>
            </nav>
          </div>
        </header>

        {children}
      </body>
    </html>
  );
}