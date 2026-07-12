import type { Metadata } from "next";
import { Outfit, JetBrains_Mono } from "next/font/google";
import { DEFAULT_THEME, THEME_REGISTRY, TooltipProvider } from "@spielos/design-system";
import { Toaster } from "sonner";
import { ThemeBootstrap } from "../components/theme-bootstrap";
import { RunContextProvider } from "../lib/run-context";
import { WorkspaceStoreProvider } from "../lib/use-workspace-store";
import { SeedBootstrap } from "../components/seed-bootstrap";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap"
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap"
});

export const metadata: Metadata = {
  title: "SpielOS",
  description: "AI marketing team harness"
};

const themeIds = THEME_REGISTRY.map((t) => t.id);

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html data-theme={DEFAULT_THEME} lang="en" suppressHydrationWarning className={`${outfit.variable} ${jetbrainsMono.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('spielos.theme');if(${JSON.stringify(themeIds)}.includes(t)){document.documentElement.dataset.theme=t;}else{document.documentElement.dataset.theme='${DEFAULT_THEME}';}}catch(e){document.documentElement.dataset.theme='${DEFAULT_THEME}';}})();`
          }}
        />
      </head>
      <body>
        <RunContextProvider>
          <ThemeBootstrap />
          <SeedBootstrap />
          <WorkspaceStoreProvider>
            <TooltipProvider delayDuration={200} skipDelayDuration={300}>
              {children}
            </TooltipProvider>
          </WorkspaceStoreProvider>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "var(--panel-strong)",
                color: "var(--foreground)",
                border: "1px solid var(--border)"
              }
            }}
          />
        </RunContextProvider>
      </body>
    </html>
  );
}
