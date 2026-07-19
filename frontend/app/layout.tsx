"use client";

import "./globals.css";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import ContactSupportModal, { type ContactSupportContext } from "./ContactSupportModal";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [contactContext, setContactContext] = useState<ContactSupportContext>({});
  const pathname = usePathname();
  const isHomeActive = pathname === "/";
  const isProjectsActive = pathname === "/projects" || pathname.startsWith("/projects/");
  const isAlgorithmsActive = pathname.startsWith("/algorithms");

  useEffect(() => {
    function handleOpenContact(event: Event) {
      const detail =
        event instanceof CustomEvent && typeof event.detail === "object" && event.detail
          ? (event.detail as ContactSupportContext)
          : {};

      setContactContext(detail);
      setIsContactOpen(true);
    }

    window.addEventListener("grnscope:open-contact", handleOpenContact);
    return () => window.removeEventListener("grnscope:open-contact", handleOpenContact);
  }, []);

  function openContactModal() {
    setContactContext({
      pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
    });
    setIsContactOpen(true);
  }

  return (
    <html lang="en">
      <body style={{ "--grnscope-header-height": "78px" } as React.CSSProperties}>
        <header className="sticky top-0 z-[60] border-b border-[#1a3448] bg-[#213f54]">
          <div className="mx-auto flex h-[78px] w-full max-w-[1440px] items-center px-3 sm:px-6 lg:px-9 xl:px-16">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2 sm:gap-4"
              aria-label="Go to GRNScope home page"
            >
              <div className="relative flex h-11 w-11 items-center justify-center bg-transparent sm:h-[62px] sm:w-[62px]">
                <svg
                  viewBox="0 0 64 64"
                  className="relative h-10 w-10 sm:h-[52px] sm:w-[52px]"
                  role="img"
                  aria-label="GRNScope gene regulatory network logo"
                >
                  <path d="M20.5 20.5C24.5 22 28.1 25 30.5 27" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" opacity="0.82" />
                  <path d="M36.4 27.3C40.2 24.2 43.5 21.5 46.7 19.4" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" opacity="0.82" />
                  <path d="M35.4 32.1C38.3 35.8 40.7 39.4 42.3 43" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" opacity="0.82" />
                  <path d="M30.3 32.2C26.4 36.2 23.2 39.9 19.9 43.4" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" opacity="0.58" />
                  <path d="M15.5 11.5 22.5 18.5 15.5 25.5 8.5 18.5Z" fill="#61d0c4" />
                  <circle cx="33" cy="29.5" r="4.5" fill="#ffffff" />
                  <circle cx="50.5" cy="17" r="6" fill="#ffffff" />
                  <circle cx="44.5" cy="47.5" r="6.5" fill="#ffffff" />
                  <circle cx="17" cy="47" r="4.75" fill="#61d0c4" />
                </svg>
              </div>
              <p className="hidden text-[30px] font-medium leading-none tracking-[-0.045em] text-white sm:block">
                GRNScope
              </p>
            </Link>
            <nav className="ml-auto flex items-center gap-0.5 sm:gap-2 lg:gap-5" aria-label="Main navigation">
              <Link
                href="/"
                aria-current={isHomeActive ? "page" : undefined}
                className={`cursor-pointer rounded-full px-2 py-2 text-[11px] font-bold transition hover:text-white sm:px-3 sm:text-sm lg:px-4 lg:py-2.5 lg:text-base ${
                  isHomeActive
                    ? "bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                    : "bg-transparent text-white/90"
                }`}
              >
                Home
              </Link>
              <Link
                href="/projects"
                aria-current={isProjectsActive ? "page" : undefined}
                className={`cursor-pointer rounded-full px-2 py-2 text-[11px] font-bold transition hover:text-white sm:px-3 sm:text-sm lg:px-4 lg:py-2.5 lg:text-base ${
                  isProjectsActive
                    ? "bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                    : "bg-transparent text-white/90"
                }`}
              >
                Projects
              </Link>
              <Link
                href="/algorithms"
                aria-current={isAlgorithmsActive ? "page" : undefined}
                className={`cursor-pointer rounded-full px-2 py-2 text-[11px] font-bold transition hover:text-white sm:px-3 sm:text-sm lg:px-4 lg:py-2.5 lg:text-base ${
                  isAlgorithmsActive
                    ? "bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                    : "bg-transparent text-white/90"
                }`}
              >
                Algorithms
              </Link>
              <button
                type="button"
                onClick={openContactModal}
                className="cursor-pointer rounded-full bg-transparent px-2 py-2 text-[11px] font-bold text-white/90 transition hover:text-white sm:px-3 sm:text-sm lg:px-4 lg:py-2.5 lg:text-base"
              >
                <span className="sm:hidden">Contact</span>
                <span className="hidden sm:inline">Contact us</span>
              </button>
            </nav>
          </div>
        </header>

        {children}
        <ContactSupportModal
          open={isContactOpen}
          context={contactContext}
          onClose={() => setIsContactOpen(false)}
        />
      </body>
    </html>
  );
}
