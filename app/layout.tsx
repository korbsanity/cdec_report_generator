import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Armenia O&M Reporting",
  description: "Local grass-cutting and panel-cleaning progress maps and reports.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
