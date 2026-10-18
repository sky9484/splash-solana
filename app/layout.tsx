import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { Providers } from "./providers";

/**
 * Every page renders per request. The Content-Security-Policy carries a
 * nonce minted in proxy.ts for that request, and Next applies it to its
 * scripts during server rendering — a prerendered page would ship without
 * it, and its scripts would be refused by the very policy meant to protect
 * it. The cost is no static prerendering of the marketing pages, accepted
 * deliberately: a fintech app's pages are not the kind that need a CDN copy.
 */
export const dynamic = 'force-dynamic';

const fontSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const fontMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: "Splash · Pay suppliers abroad. Prove every payment.",
  description: "Malaysian businesses pay suppliers in the Philippines in USDC on Solana. Delivered to their bank, with proof for the auditor. Sandbox.",
  openGraph: {
    title: "Splash · Pay suppliers abroad. Prove every payment.",
    description: "Pay suppliers abroad in USDC on Solana. A person approves every payment, and every payment keeps its proof.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Splash · Pay suppliers abroad. Prove every payment.",
    description: "Pay suppliers abroad in USDC on Solana. A person approves every payment, and every payment keeps its proof.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontMono.variable} h-full font-sans antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full sp-page sp-ground-paper text-[#326273]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
