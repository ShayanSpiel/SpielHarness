import type { Metadata } from "next";
import "./globals.css";
import AppProviders from "./app-providers";

export const metadata: Metadata = {
  title: "SpielOS",
  description: "AI marketing team harness",
  icons: { icon: "/favicon.svg" }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}
