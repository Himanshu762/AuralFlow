import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  /* Draw under the notch / status bar so the shell owns the full screen. */
  viewportFit: "cover",
  themeColor: "#000000",
};

export const metadata: Metadata = {
  title: "AuralFlow",
  description:
    "A lossless music player with a reinforcement-learning DJ that curates tracks from your mood and emotional flow.",
  applicationName: "AuralFlow",
  appleWebApp: {
    capable: true,
    title: "AuralFlow",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false, address: false, email: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} style={{ colorScheme: "dark" }}>
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
