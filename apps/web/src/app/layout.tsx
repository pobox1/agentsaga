import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: "Saga", template: "%s · Saga" },
  description: "Failure-safe settlement for multi-agent workflows. Built on Arc.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body>
        <Providers>
          <SiteHeader />
          {children}
          <footer className="site-footer">
            <span>Saga · Built on Arc · testnet only · not audited</span>
            <span>Compensation is an explicit action, never a claim of reversal.</span>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
