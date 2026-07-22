"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@spielos/design-system/components";
import { GoogleLogo, Notice, Spinner } from "@spielos/design-system";
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
  const [signInError, setSignInError] = useState<string | null>(null);

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
    setSignInError(null);
    try {
      const result = await signIn.social({
        provider: "google",
        callbackURL: callbackUrl,
      });
      if (result?.error) {
        setSignInError(result.error.message ?? "Google sign-in could not be started. Check the configured app URL and OAuth callback.");
        setSigningIn(false);
      }
    } catch (error) {
      setSignInError(error instanceof Error ? error.message : "Google sign-in could not be started.");
      setSigningIn(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen min-h-screen w-full items-center justify-center bg-background">
        <Spinner size="lg" />
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
                <GoogleLogo size={16} />
              )}
              Continue with Google
            </button>
            {signInError ? (
              <Notice className="mt-3" tone="destructive">{signInError}</Notice>
            ) : null}
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
        <Spinner size="lg" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
