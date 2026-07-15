import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "101 Okey — Minimal Oyun Masası",
  description: "Modern, minimalist ve etkileşimli 101 Okey prototipi.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "101 Okey",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icon-192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <head>
        <meta name="theme-color" content="#35101f" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
