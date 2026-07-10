import type { Metadata } from "next";
import { Outfit, JetBrains_Mono } from "next/font/google";
import { TooltipProvider } from "@spielos/design-system";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html data-theme="gruvbox-dark" lang="en" suppressHydrationWarning className={`${outfit.variable} ${jetbrainsMono.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('spielos.theme');var v=['monochrome-dark','monochrome-light','gruvbox-dark','gruvbox-light'];if(v.includes(t)){document.documentElement.dataset.theme=t;}else{document.documentElement.dataset.theme='gruvbox-dark';}}catch(e){document.documentElement.dataset.theme='gruvbox-dark';}})();`
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
            theme="dark"
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
