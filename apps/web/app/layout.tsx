import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppProviders from "./app-providers";
import { DEFAULT_THEME_META_COLOR } from "@spielos/design-system";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: DEFAULT_THEME_META_COLOR
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
