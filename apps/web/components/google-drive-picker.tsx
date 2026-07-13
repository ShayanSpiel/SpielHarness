"use client";

import { useEffect, useState, useCallback } from "react";
import { Button, EmptyState, Input, Notice, ResizableSidebar, SIDEBAR, Tooltip, toast } from "@spielos/design-system";
import { Icon } from "@spielos/design-system/components";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

interface DriveStatus {
  connected: boolean;
  account?: string | null;
}

function getFileIcon(mimeType: string): string {
  if (mimeType === "application/vnd.google-apps.folder") return "folder";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "table";
  if (mimeType.includes("document") || mimeType.includes("word")) return "file-text";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return "presentation";
  if (mimeType.includes("pdf")) return "file-text";
  if (mimeType.includes("video")) return "video";
  if (mimeType.includes("audio")) return "music";
  return "file";
}

function formatFileSize(bytes?: string): string {
  if (!bytes) return "";
  const size = parseInt(bytes, 10);
  if (isNaN(size)) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(dateString?: string): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

export function GoogleDrivePicker() {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  const [importing, setImporting] = useState(false);

  const importToWorkspace = useCallback(async (file: DriveFile) => {
    setImporting(true);
    try {
      const response = await fetch("/api/harness/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: file.name,
          body: "",
          fileType: "knowledge",
          status: "active",
          metadata: {
            source: "google-drive",
            driveId: file.id,
            mimeType: file.mimeType,
            size: file.size,
            modifiedTime: file.modifiedTime,
            webViewLink: file.webViewLink
          }
        })
      });
      if (!response.ok) throw new Error("Failed to import");
      toast.success(`Imported "${file.name}" to workspace`);
      window.dispatchEvent(new Event("spielos:workspace-reload"));
    } catch {
      toast.error("Failed to import file");
    } finally {
      setImporting(false);
    }
  }, []);

  const fetchFiles = useCallback(async (query = "", pageToken?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (pageToken) params.set("pageToken", pageToken);
      params.set("pageSize", "20");

      const response = await fetch(`/api/google-drive/files?${params.toString()}`);
      if (!response.ok) {
        if (response.status === 401) {
          setStatus({ connected: false });
          return;
        }
        throw new Error("Failed to fetch files");
      }

      const data = await response.json() as { files: DriveFile[]; nextPageToken?: string };
      if (pageToken) {
        setFiles((prev) => [...prev, ...data.files]);
      } else {
        setFiles(data.files);
      }
      setNextPageToken(data.nextPageToken ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch files");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/google-drive/status")
      .then((res) => res.json())
      .then((data: DriveStatus) => {
        setStatus(data);
        if (data.connected) {
          fetchFiles();
        }
      })
      .catch(() => setStatus({ connected: false }));
  }, [fetchFiles]);

  const handleSearch = () => {
    fetchFiles(searchQuery);
  };

  const handleLoadMore = () => {
    if (nextPageToken) {
      fetchFiles(searchQuery, nextPageToken);
    }
  };

  if (status === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Icon name="loader" size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status.connected) {
    return (
      <EmptyState
        icon={<Icon name="folder" size={24} />}
        title="Connect Google Drive"
        description="Access your Google Drive files directly from here."
        action={
          <Button
            onClick={() => {
              window.location.href = "/api/auth/google?integration=google-drive";
            }}
            size="md"
            variant="primary"
          >
            <Icon name="lock" size={14} />
            Connect Google Drive
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Input
          placeholder="Search Drive files..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearch();
          }}
          className="flex-1"
        />
        <Tooltip content="Search Drive" side="bottom">
          <Button aria-label="Search Drive" icon="search" onClick={handleSearch} size="icon-xs" variant="ghost" />
        </Tooltip>
        <Tooltip content="Refresh files" side="bottom">
          <Button aria-label="Refresh files" icon="refresh" onClick={() => fetchFiles(searchQuery)} size="icon-xs" variant="ghost" />
        </Tooltip>
      </div>

      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <ResizableSidebar defaultWidth={SIDEBAR.LIST.NARROW_DEFAULT} sidebarId="google-drive" title="Google Drive">
          <div className="flex h-10 items-center gap-2 border-b border-border px-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Google Drive
            </span>
            {status.account && (
              <span className="ml-auto text-2xs text-muted-foreground truncate max-w-[120px]">
                {status.account}
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading && files.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Icon name="loader" size={16} className="animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <Notice tone="destructive" title="Could not load Drive files">{error}</Notice>
            ) : files.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                No files found
              </div>
            ) : (
              <ul className="grid gap-0.5">
                {files.map((file) => (
                  <li key={file.id}>
                    <button
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                        selectedFile?.id === file.id
                          ? "bg-selected text-foreground-strong"
                          : "text-foreground-muted hover:bg-hover hover:text-foreground"
                      }`}
                      onClick={() => setSelectedFile(file)}
                      type="button"
                    >
                      <Icon name={getFileIcon(file.mimeType)} size={12} />
                      <span className="truncate">{file.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {nextPageToken && (
              <div className="mt-2 flex justify-center">
                <Button icon="arrow-down" loading={loading} onClick={handleLoadMore} size="sm" variant="ghost">
                  Load more
                </Button>
              </div>
            )}
          </div>
        </ResizableSidebar>

        <main className="flex min-w-0 flex-1 flex-col bg-background">
          {selectedFile ? (
            <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
              <div className="flex h-9 items-center gap-2 border-b border-border bg-panel-raised px-3 text-2xs">
                <Icon name={getFileIcon(selectedFile.mimeType)} size={12} />
                <span className="font-medium text-foreground">{selectedFile.name}</span>
                {selectedFile.size && (
                  <span className="text-muted-foreground">{formatFileSize(selectedFile.size)}</span>
                )}
                {selectedFile.modifiedTime && (
                  <span className="text-muted-foreground">{formatDate(selectedFile.modifiedTime)}</span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    onClick={() => importToWorkspace(selectedFile)}
                    size="sm"
                    variant="outline"
                    icon="plus"
                    loading={importing}
                  >
                    Import to workspace
                  </Button>
                  {selectedFile.webViewLink && (
                    <Button asChild size="sm" variant="link">
                      <a href={selectedFile.webViewLink} rel="noopener noreferrer" target="_blank">
                        Open in Drive
                      </a>
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
                <div className="text-center">
                  <Icon name={getFileIcon(selectedFile.mimeType)} size={24} className="mx-auto mb-3 text-muted-foreground" />
                  <p className="font-medium text-foreground">{selectedFile.name}</p>
                  <p className="mt-1 text-xs">
                    {selectedFile.mimeType.split("/").pop()?.replace(/\./g, " ").toUpperCase()}
                  </p>
                  {selectedFile.size && (
                    <p className="mt-1 text-xs">{formatFileSize(selectedFile.size)}</p>
                  )}
                  {selectedFile.modifiedTime && (
                    <p className="mt-1 text-xs">Modified {formatDate(selectedFile.modifiedTime)}</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <EmptyState
              className="flex-1"
              description="Select a file from the list to view its details."
              title="No file selected"
            />
          )}
        </main>
      </div>
    </div>
  );
}
