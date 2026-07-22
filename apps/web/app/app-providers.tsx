"use client";

import { Outfit, JetBrains_Mono } from "next/font/google";
import { useEffect, useState } from "react";
import { AppToaster, DEFAULT_THEME, ElectricBorderDefs, IconRegistryProvider, Spinner, THEME_REGISTRY, TooltipProvider } from "@spielos/design-system";
import { useSession } from "../lib/auth-client";
import { WorkspaceStoreProvider } from "../lib/use-workspace-store";
import { RunContextProvider } from "../lib/run-context";
import { ChatRuntimeProvider } from "../components/chat/chat-thread";
import { RealtimeHub } from "../lib/realtime-hub";
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
  const { data: session, isPending } = useSession();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isLoginPage = typeof window !== "undefined" && window.location.pathname === "/login";
  const ready = mounted && !isPending;
  const showSpinner = !ready || (!session && !isLoginPage);

  useEffect(() => {
    if (ready && !session && !isLoginPage) {
      const callbackUrl = encodeURIComponent(window.location.pathname);
      window.location.href = `/login?callbackUrl=${callbackUrl}`;
    }
  }, [ready, session, isLoginPage]);

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
        {showSpinner ? (
          <div className="flex h-screen items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : (
          <WorkspaceStoreProvider>
            <RealtimeHub />
            <RunContextProvider>
              <ChatRuntimeProvider>
                <IconRegistryProvider>
                  <ElectricBorderDefs />
                  <TooltipProvider delayDuration={200} skipDelayDuration={300}>
                    {children}
                  </TooltipProvider>
                </IconRegistryProvider>
              </ChatRuntimeProvider>
              <AppToaster />
            </RunContextProvider>
          </WorkspaceStoreProvider>
        )}
      </body>
    </html>
  );
}
