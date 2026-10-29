import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "Customs Pipeline",
  description: "Cross-border customs compliance pipeline",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <div className="nav-inner">
            <Link href="/" className="nav-brand">
              <span>Customs</span> Pipeline
            </Link>
            <Link href="/pipeline" className="nav-link">How it works</Link>
            <Link href="/dashboard" className="nav-link">Dashboard</Link>
            <Link href="/review" className="nav-link">Review queue</Link>
            <Link href="/rules" className="nav-link">Rules sync</Link>
            <Link href="/classify" className="nav-link">Try it live</Link>
          </div>
        </nav>
        <div className="container">{children}</div>
      </body>
    </html>
  );
}
