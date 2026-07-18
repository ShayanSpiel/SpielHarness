import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppProviders from "./app-providers";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#282828"
};

export const metadata: Metadata = {
  title: {
    default: "SpielOS",
    template: "%s | SpielOS"
  },
  description: "AI marketing team harness",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "SpielOS",
    description: "AI marketing team harness",
    type: "website"
  },
  robots: {
    index: false,
    follow: false
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}
