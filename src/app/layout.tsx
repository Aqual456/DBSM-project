import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppShell from "@/components/shell/AppShell";

export const metadata: Metadata = {
  title: { default: "ReliefFlow — Disaster Response Platform", template: "%s · ReliefFlow" },
  description: "Disaster relief coordination, resource allocation and database engineering lab",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#101b2d" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
