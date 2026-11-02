import type { Metadata } from "next";
import "./globals.css";

import SiteHeader from "./_components/SiteHeader";

export const metadata: Metadata = {
  title: "GRNScope | Gene regulatory network analysis",
  description: "Infer, compare, and explore gene regulatory networks from single-cell RNA-seq data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body style={{ "--grnscope-header-height": "78px" } as React.CSSProperties}>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
