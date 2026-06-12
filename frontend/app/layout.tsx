"use client";

import "./globals.css";
import { useEffect, useState } from "react";
import Link from "next/link";

import ContactSupportModal, { type ContactSupportContext } from "./ContactSupportModal";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [contactContext, setContactContext] = useState<ContactSupportContext>({});

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
        <header className="sticky top-0 z-[60] border-b border-[#1a3448] bg-[#213f54] shadow-[0_2px_10px_rgba(15,23,42,0.18)]">
          <div className="mx-auto flex h-[78px] w-full max-w-[1440px] items-center px-9 xl:px-16">
            <Link
              href="/"
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
            <button
              type="button"
              onClick={openContactModal}
              className="ml-auto cursor-pointer rounded-full bg-transparent px-4 py-2.5 text-base font-bold text-white/90 transition hover:text-white"
            >
              Contact
            </button>
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
