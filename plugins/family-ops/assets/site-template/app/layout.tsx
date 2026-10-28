import type { Metadata } from "next";
import "./globals.css";

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#eef0e6' };

export const metadata: Metadata = {
  title: "Family Ops — a little more together",
  description: "A flexible home for your family's plans, preparation and everyday life.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Family Ops" },
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon-192.png",
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
