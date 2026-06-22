import type { ReactNode } from "react";

export const metadata = {
  title: "SWIP Customs Pipeline",
  description: "Cross-border customs compliance pipeline",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "2rem", lineHeight: 1.5 }}>
        {children}
      </body>
    </html>
  );
}
