"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@spielos/design-system/components";
import { Spinner } from "@spielos/design-system";
import { signIn } from "../../lib/auth-client";

type Session = {
  user: {
    id: string;
    email: string;
    name: string | null;
  };
} | null;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    fetch("/api/auth/get-session")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setSession(data?.session ?? null);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!loading && session) {
      router.push(callbackUrl);
    }
  }, [session, loading, router, callbackUrl]);

  async function handleGoogleSignIn() {
    setSigningIn(true);
    try {
      await signIn.social({
        provider: "google",
        callbackURL: callbackUrl,
      });
    } catch {
      setSigningIn(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen min-h-screen w-full items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (session) {
    return null;
  }

  return (
    <div className="flex h-screen min-h-screen w-full items-center justify-center bg-background">
      <div className="w-full max-w-sm px-4">
        <div className="rounded-md border border-border bg-panel p-6">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-panel-raised text-foreground-strong">
              <Icon name="box" size={20} />
            </div>
            <div className="text-center">
              <h1 className="text-base font-semibold text-foreground-strong">
                SpielOS
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Sign in to your workspace
              </p>
            </div>
          </div>

          <div className="mt-6">
            <button
              disabled={signingIn}
              onClick={handleGoogleSignIn}
              type="button"
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-panel-raised px-4 text-sm font-medium text-foreground transition-colors duration-[var(--duration)] hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-50"
            >
              {signingIn ? (
                <Spinner size="sm" />
              ) : (
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
              )}
              Continue with Google
            </button>
          </div>

          <p className="mt-4 text-center text-2xs text-muted-foreground">
            By signing in, you agree to the terms of service.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen min-h-screen w-full items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
