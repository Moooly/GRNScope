import "./globals.css";

import SiteHeader from "./_components/SiteHeader";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ "--grnscope-header-height": "78px" } as React.CSSProperties}>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
