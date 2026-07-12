"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState } from "@spielos/design-system";
import { Icon } from "@spielos/design-system/components";
import { GooglePicker, type PickedFile } from "./google-picker";
import { useWorkspaceStore } from "../lib/use-workspace-store";

type ConnectionState = "disconnected" | "connecting" | "connected";

const GOOGLE_DRIVE_APP_ID = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_APP_ID || "";

export function LibraryFilesSection() {
  const store = useWorkspaceStore();
  const [connection, setConnection] = useState<ConnectionState>("disconnected");
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const pickedFiles = store.items.filter(
    (item) => item.kind === "library" && item.metadata?.source === "drive"
  );

  // Check if already authenticated on mount
  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const res = await fetch("/api/auth/google/token");
      if (res.ok) {
        const data = await res.json();
        if (data.accessToken) {
          setAccessToken(data.accessToken);
          setConnection("connected");
        }
      }
    } catch {
      // not authenticated
    }
  }

  function handleConnect() {
    setConnection("connecting");
    window.location.href = "/api/auth/google";
  }

  async function handleDisconnect() {
    try {
      await fetch("/api/auth/google/revoke", { method: "POST" });
    } catch {
      // best effort
    }
    setConnection("disconnected");
    setAccessToken(null);
  }

  const handlePickedFiles = useCallback(
    (files: PickedFile[]) => {
      for (const file of files) {
        const exists = store.items.some(
          (item) => item.metadata?.driveFileId === file.id
        );
        if (!exists) {
          store.addItem({
            kind: "library",
            title: file.name,
            body: "",
            folder: "Files",
            status: "active",
            metadata: {
              source: "drive",
              driveFileId: file.id,
              mimeType: file.mimeType,
              webViewLink: file.webViewLink,
              driveIconUrl: file.iconUrl,
              sizeBytes: String(file.sizeBytes)
            }
          });
        }
      }
    },
    [store]
  );

  if (connection === "disconnected") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-border bg-panel-raised">
          <Icon name="cloud" size={32} />
        </div>
        <div className="text-center">
          <h3 className="text-sm font-semibold text-foreground">
            Connect Google Drive
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Link your Google Drive to browse and select files directly from your
            knowledge base. Files are stored as references — content is fetched
            on demand.
          </p>
        </div>
        <Button className="h-9 px-4" onClick={handleConnect} size="md">
          <Icon name="cloud" className="mr-1.5" size={16} />
          Connect Google Drive
        </Button>
      </div>
    );
  }

  if (connection === "connecting") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <Icon name="loader" className="animate-spin" size={24} />
        <p className="text-sm text-muted-foreground">
          Connecting to Google Drive...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2 text-xs text-success">
           <Icon name="check-circle" size={14} />
           <span>Connected</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {accessToken ? (
            <GooglePicker
              accessToken={accessToken}
              appId={GOOGLE_DRIVE_APP_ID}
              onSelect={handlePickedFiles}
            />
          ) : null}
          <Button
            className="px-2"
            icon="x"
            onClick={handleDisconnect}
            size="sm"
            variant="ghost"
          >
            Disconnect
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {pickedFiles.length === 0 ? (
          <EmptyState
            className="pt-16"
            description="Click 'Pick files' to browse and select files from Google Drive."
            icon={<Icon name="cloud" size={24} />}
            title="No Drive files selected"
          />
        ) : (
          <div className="grid gap-2">
            {pickedFiles.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-panel-raised px-3 py-2.5 transition-colors hover:bg-hover"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background">
                  <Icon name="file" size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {item.title}
                  </p>
                  <p className="text-2xs text-muted-foreground">
                    {item.metadata?.mimeType || "Unknown type"}
                    {item.metadata?.sizeBytes
                      ? ` · ${formatSize(Number(item.metadata.sizeBytes))}`
                      : ""}
                  </p>
                </div>
                {item.metadata?.webViewLink ? (
                  <a
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    href={item.metadata.webViewLink as string}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <Icon name="external-link" size={14} />
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
