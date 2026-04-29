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

    if (pathname === "/projects/demo") {
      setActiveHeaderItem("sample");
      return;
    }

    if (pathname.startsWith("/projects") || pathname.startsWith("/login")) {
      setActiveHeaderItem("workspace");
    }
  }, [pathname]);

  const workspaceHref = isLoggedIn ? "/projects" : "/login";

  const navItemClass = (isActive: boolean) =>
    [
      "group inline-flex h-10 min-w-[128px] items-center justify-center gap-2.5 rounded-full px-3.5 text-[15px] font-semibold leading-none transition-all duration-200",
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#26c487]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#213f54]",
      isActive
        ? "bg-[#20b779]/12 text-[#24c684] shadow-sm shadow-slate-950/10 ring-1 ring-[#20b779]/20"
        : "text-[#b8c1c9] hover:bg-white/5 hover:text-white",
    ].join(" ");

  const navIconClass = "h-[19px] w-[19px] shrink-0";
  const isActive = (item: string) => activeHeaderItem === item;

  return (
    <html lang="en">
      <body style={{ "--grnscope-header-height": "78px" } as React.CSSProperties}>
        <header className="sticky top-0 z-[60] border-b border-[#1a3448] bg-[#213f54] shadow-[0_2px_10px_rgba(15,23,42,0.18)]">
          <div className="mx-auto flex h-[78px] w-full max-w-[1440px] items-center px-9 xl:px-16">
            <Link
              href="/"
              onClick={() => setActiveHeaderItem("home")}
              className="flex shrink-0 items-center gap-4"
              aria-label="Go to GRNScope home page"
            >
              <div className="relative flex h-[62px] w-[62px] items-center justify-center bg-transparent">
                <svg
                  viewBox="0 0 64 64"
                  className="relative h-[58px] w-[58px]"
                  role="img"
                  aria-label="GRNScope gene regulatory network logo"
                >


                  <path
                    d="M32 13 L32 51"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M14 23 L32 13 L50 23"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M14 23 L14 41 L32 51 L50 41 L50 23"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M14 41 L32 31 L50 41"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.85"
                  />
                  <path
                    d="M14 23 L32 31 L50 23"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.85"
                  />

                  <rect
                    x="23.2"
                    y="23.2"
                    width="17.6"
                    height="17.6"
                    rx="1.6"
                    fill="#5fc8bd"
                    transform="rotate(45 32 32)"
                  />
                  <path
                    d="M32 21 L32 43"
                    stroke="#eafffb"
                    strokeWidth="2"
                    strokeLinecap="round"
                    opacity="0.9"
                  />
                  <path
                    d="M22 32 L42 32"
                    stroke="#eafffb"
                    strokeWidth="2"
                    strokeLinecap="round"
                    opacity="0.9"
                  />

                  <circle cx="32" cy="13" r="4.9" fill="#ffffff" />
                  <circle cx="14" cy="23" r="4.9" fill="#ffffff" />
                  <circle cx="50" cy="23" r="4.9" fill="#ffffff" />
                  <circle cx="14" cy="41" r="4.9" fill="#ffffff" />
                  <circle cx="50" cy="41" r="4.9" fill="#ffffff" />
                  <circle cx="32" cy="51" r="4.9" fill="#ffffff" />
                </svg>
              </div>
              <p className="text-[30px] font-medium leading-none tracking-[-0.045em] text-white">
                GRNScope
              </p>
            </Link>

            <nav className="ml-auto flex items-center gap-4" aria-label="Primary navigation">
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

              <Link
                href="/projects/demo"
                onClick={() => setActiveHeaderItem("sample")}
                className={navItemClass(isActive("sample"))}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={navIconClass}
                  aria-hidden="true"
                >
                  <path d="M4.75 4A1.75 1.75 0 0 0 3 5.75v12.5C3 19.216 3.784 20 4.75 20h14.5A1.75 1.75 0 0 0 21 18.25V5.75A1.75 1.75 0 0 0 19.25 4H4.75Zm1.5 3.5h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1 0-1.5Zm0 3.75h11.5a.75.75 0 0 1 0 1.5H6.25a.75.75 0 0 1 0-1.5Zm0 3.75h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Z" />
                </svg>
                <span>Demo Project</span>
              </Link>

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
            </nav>
          </div>
        </header>

        {children}
      </body>
    </html>
  );
}