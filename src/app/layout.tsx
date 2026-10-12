import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { Anchor, FlaskConical } from "lucide-react";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "BerthWise — AI Berth & Yard Optimization for the Port of Casablanca",
  description:
    "Berth allocation, yard stacking and vessel ETA prediction for congested ports. Interactive demo with realistic Casablanca port data.",
};

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-harbor-800 bg-harbor-950/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-signal-400 text-harbor-950">
            <Anchor className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-white">
            Berth<span className="text-signal-400">Wise</span>
          </span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/demo"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-300 transition-colors hover:text-signal-300"
          >
            Live demo
          </Link>
          <a
            href="https://github.com/eliem08/berthwise"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-harbor-600 px-3 py-2 text-sm font-semibold text-slate-300 transition-colors hover:border-signal-400 hover:text-signal-300"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-harbor-800 bg-harbor-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-harbor-800 text-signal-400">
            <Anchor className="h-4 w-4" strokeWidth={2.5} />
          </span>
          <p className="text-sm text-slate-400">
            <span className="font-display font-bold text-slate-200">BerthWise</span> — berth
            allocation &amp; yard optimization for congested ports.
          </p>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <FlaskConical className="h-3.5 w-3.5" />
          Demonstration with stylized data — heuristics, not a production TOS.
        </p>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable}`}>
      <body>
        <Header />
        <main className="min-h-[calc(100vh-8rem)]">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
