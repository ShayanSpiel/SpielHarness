"use client";

import { Outfit, JetBrains_Mono } from "next/font/google";
import { AppToaster, DEFAULT_THEME, THEME_REGISTRY, TooltipProvider } from "@spielos/design-system";
import { RunContextProvider } from "../lib/run-context";
import { WorkspaceStoreProvider } from "../lib/use-workspace-store";
import "../components/chat/chat-markdown.css";

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

const themeIds = THEME_REGISTRY.map((t) => t.id);

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <html
      data-theme={DEFAULT_THEME}
      lang="en"
      suppressHydrationWarning
      className={`${outfit.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('spielos.theme');if(${JSON.stringify(
              themeIds
            )}.includes(t)){document.documentElement.dataset.theme=t;}else{document.documentElement.dataset.theme='${DEFAULT_THEME}';}}catch(e){document.documentElement.dataset.theme='${DEFAULT_THEME}';}})();`
          }}
        />
      </head>
      <body>
        <RunContextProvider>
          <WorkspaceStoreProvider>
            <TooltipProvider delayDuration={200} skipDelayDuration={300}>
              {children}
            </TooltipProvider>
          </WorkspaceStoreProvider>
          <AppToaster />
        </RunContextProvider>
      </body>
    </html>
  );
}
