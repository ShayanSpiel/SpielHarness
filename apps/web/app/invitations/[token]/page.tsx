"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Spinner } from "@spielos/design-system";
import { signIn } from "../../../lib/auth-client";

type InvitationData = {
  email: string;
  org_name: string;
};

type Session = {
  user: {
    id: string;
    email: string;
    name: string | null;
  };
} | null;

export default function InvitationPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/invitations/${token}`).then((r) => r.ok ? r.json() : r.json().then((d) => Promise.reject(d.error))),
      fetch("/api/auth/get-session").then((r) => r.ok ? r.json() : null),
    ])
      .then(([inv, sess]) => {
        setInvitation(inv as InvitationData);
        setSession(sess?.session ?? null);
      })
      .catch((err) => setError(typeof err === "string" ? err : "Invitation not found or expired"))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleAccept() {
    setAccepting(true);
    try {
      const res = await fetch(`/api/invitations/${token}`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to accept invitation");
        return;
      }
      router.push("/");
    } catch {
      setError("Failed to accept invitation");
    } finally {
      setAccepting(false);
    }
  }

  async function handleSignIn() {
    await signIn.social({
      provider: "google",
      callbackURL: `/invitations/${token}`,
    });
  }

  if (loading) {
    return (
      <div className="flex h-screen min-h-screen w-full items-center justify-center bg-background">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen min-h-screen w-full items-center justify-center bg-background">
        <div className="max-w-sm rounded-md border border-border bg-panel p-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">Invitation Error</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen min-h-screen w-full items-center justify-center bg-background">
      <div className="max-w-sm rounded-md border border-border bg-panel p-6 text-center">
        <h1 className="text-lg font-semibold text-foreground">You&apos;re invited!</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You&apos;ve been invited to join <strong>{invitation?.org_name}</strong>.
        </p>
        {session ? (
          <div className="mt-6 space-y-3">
            <p className="text-xs text-muted-foreground">
              Signed in as <strong>{session.user.email}</strong>
            </p>
            <Button onClick={handleAccept} loading={accepting} size="md" variant="primary" className="w-full">
              Accept Invitation
            </Button>
          </div>
        ) : (
          <div className="mt-6">
            <Button onClick={handleSignIn} size="md" variant="primary" className="w-full">
              Sign in to accept
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
