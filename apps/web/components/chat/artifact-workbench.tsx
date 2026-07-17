"use client";

import { useMemo, useState } from "react";
import { parseArtifactProject, type Artifact, type ArtifactFile, type ArtifactProject } from "@spielos/core";
import { Icon } from "@spielos/design-system/components";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  Pill,
  Tooltip,
  cn
} from "@spielos/design-system";

type View = "preview" | "source" | "files";

function fileLabel(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function fileIcon(file: ArtifactFile) {
  if (file.mimeType === "text/html") return "globe";
  if (file.mimeType === "text/css") return "file-code";
  if (file.mimeType.includes("javascript")) return "code";
  if (file.mimeType === "application/pdf") return "file-text";
  if (file.mimeType.startsWith("image/")) return "image";
  if (file.mimeType.includes("json")) return "code";
  return "file";
}

function dataUrl(file: ArtifactFile): string {
  return file.encoding === "base64"
    ? `data:${file.mimeType};base64,${file.content}`
    : `data:${file.mimeType};charset=utf-8,${encodeURIComponent(file.content)}`;
}

function previewHtml(project: ArtifactProject): string {
  const entry = project.files.find((file) => file.path === project.entrypoint);
  if (!entry) return "<!doctype html><title>Preview unavailable</title>";
  const byPath = new Map(project.files.map((file) => [file.path.replace(/^\.\//, ""), file]));
  let html = entry.content;
  html = html.replace(/<link\b([^>]*?)href=["']([^"']+)["']([^>]*)>/gi, (tag, before: string, href: string) => {
    const file = byPath.get(href.replace(/^\.\//, ""));
    return file?.mimeType === "text/css" ? `<style data-artifact-path="${href}">\n${file.content}\n</style>` : tag;
  });
  html = html.replace(/\bsrc=["']([^"']+)["']/gi, (attribute, source: string) => {
    const file = byPath.get(source.replace(/^\.\//, ""));
    return file && (file.mimeType.startsWith("image/") || file.mimeType.startsWith("font/"))
      ? `src="${dataUrl(file)}"`
      : attribute;
  });
  html = html.replace(/<script\b([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, before: string, source: string, after: string) => {
    const file = byPath.get(source.replace(/^\.\//, ""));
    return file?.mimeType.includes("javascript")
      ? `<script data-artifact-path="${source}"${before}${after}>\n${file.content}\n</script>`
      : tag;
  });
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
  return /<head[\s>]/i.test(html)
    ? html.replace(/<head([^>]*)>/i, `<head$1>${policy}`)
    : `${policy}${html}`;
}

function SourceView({ file, fullscreen = false }: { file: ArtifactFile; fullscreen?: boolean }) {
  if (file.mimeType === "application/pdf" && file.encoding === "base64") {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-2 p-6 text-center">
        <Icon className="text-info" name="file-text" size={24} />
        <div className="text-xs font-medium text-foreground">Binary PDF</div>
        <div className="max-w-sm text-2xs text-muted-foreground">Generated from {file.sourcePath ?? "the project source"}. Use Preview to inspect the rendered document.</div>
      </div>
    );
  }
  let source = file.content;
  if (file.mimeType.includes("json")) {
    try { source = JSON.stringify(JSON.parse(source), null, 2); } catch {}
  }
  return <pre className={cn("overflow-auto whitespace-pre p-3 font-mono text-2xs leading-5 text-foreground/90", fullscreen ? "min-h-0 flex-1" : "max-h-[28rem]")}>{source}</pre>;
}

function PreviewView({ file, fullscreen = false, project }: { file: ArtifactFile; fullscreen?: boolean; project: ArtifactProject }) {
  if (file.mimeType === "text/html") {
    return (
      <iframe
        aria-label={`${project.name} HTML preview`}
        className={cn("w-full border-0 bg-surface", fullscreen ? "min-h-0 flex-1" : "h-[28rem]")}
        sandbox="allow-scripts"
        srcDoc={previewHtml({ ...project, entrypoint: file.path })}
        title={`${project.name} preview`}
      />
    );
  }
  if (file.mimeType === "application/pdf" && file.encoding === "base64") {
    return <iframe aria-label={`${file.path} PDF preview`} className={cn("w-full border-0 bg-surface", fullscreen ? "min-h-0 flex-1" : "h-[28rem]")} src={dataUrl(file)} title={`${file.path} PDF preview`} />;
  }
  if (file.mimeType.startsWith("image/")) {
    return (
      <div className="flex min-h-64 items-center justify-center bg-surface p-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={fileLabel(file.path)} className="max-h-[24rem] max-w-full object-contain" src={dataUrl(file)} />
      </div>
    );
  }
  return <SourceView file={file} fullscreen={fullscreen} />;
}

export function ArtifactWorkbench({ artifact, compact = false, fullscreen = false }: { artifact: Artifact; compact?: boolean; fullscreen?: boolean }) {
  const project = useMemo(() => parseArtifactProject(artifact.body), [artifact.body]);
  const [view, setView] = useState<View>("preview");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  if (!project) {
    return <pre className={cn("overflow-auto whitespace-pre-wrap p-3 text-xs leading-5 text-foreground", fullscreen ? "min-h-0 flex-1" : compact ? "max-h-72" : "max-h-[28rem]")}>{artifact.body}</pre>;
  }

  const preferred = selectedPath ?? project.entrypoint;
  const selected = project.files.find((file) => file.path === preferred) ?? project.files[0];
  const previewable = selected.mimeType === "text/html" || selected.mimeType === "application/pdf" || selected.mimeType.startsWith("image/");

  return (
    <div className={cn("min-w-0 bg-panel", fullscreen && "flex h-full min-h-0 flex-col")}>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-panel-raised px-2.5 py-1.5">
        {(["preview", "source", "files"] as const).map((item) => (
          <button
            aria-pressed={view === item}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-2xs font-medium capitalize text-muted-foreground transition-colors hover:bg-hover hover:text-foreground",
              view === item && "bg-selected text-foreground"
            )}
            key={item}
            onClick={() => setView(item)}
            type="button"
          >
            <Icon name={item === "preview" ? "eye" : item === "source" ? "code" : "folder"} size={11} />
            {item}
          </button>
        ))}
        <span className="ml-auto truncate text-3xs text-muted-foreground">{selected.path}</span>
        <Pill className="h-4 text-3xs">{project.files.length} files</Pill>
      </div>

      {view === "files" ? (
        <div className={cn("overflow-auto p-2", fullscreen ? "min-h-0 flex-1" : compact ? "max-h-72" : "max-h-[28rem]")}>
          <div className="grid gap-0.5" role="list">
            {project.files.map((file) => (
              <button
                className={cn("flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover", selected.path === file.path && "bg-selected")}
                key={file.path}
                onClick={() => {
                  setSelectedPath(file.path);
                  setView(file.mimeType === "text/html" || file.mimeType === "application/pdf" || file.mimeType.startsWith("image/") ? "preview" : "source");
                }}
                role="listitem"
                type="button"
              >
                <Icon className="shrink-0 text-muted-foreground" name={fileIcon(file)} size={12} />
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">{file.path}</span>
                <span className="shrink-0 text-3xs tabular-nums text-muted-foreground">{file.content.length.toLocaleString()} {file.encoding === "base64" ? "b64" : "chars"}</span>
              </button>
            ))}
          </div>
        </div>
      ) : view === "source" || !previewable ? (
        <SourceView file={selected} fullscreen={fullscreen} />
      ) : (
        <PreviewView file={selected} fullscreen={fullscreen} project={project} />
      )}

      <div className="flex items-center gap-1.5 border-t border-border px-2.5 py-1.5 text-3xs text-muted-foreground">
        <Icon name="shield" size={10} />
        Preview is sandboxed; local scripts run, while network access, external submissions, and navigation are disabled.
      </div>
    </div>
  );
}

export function ArtifactFullscreenButton({ artifact }: { artifact: Artifact }) {
  return (
    <Dialog>
      <Tooltip content="Open fullscreen" side="bottom">
        <DialogTrigger asChild>
          <Button aria-label={`Open ${artifact.title} fullscreen`} icon="maximize" size="icon-xs" type="button" variant="ghost" />
        </DialogTrigger>
      </Tooltip>
      <DialogContent aria-describedby={undefined} hideClose layout="fullscreen">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-panel-raised px-3">
          <Icon className="text-muted-foreground" name="file-text" size={13} />
          <DialogTitle className="min-w-0 flex-1 truncate text-xs">{artifact.title}</DialogTitle>
          <Tooltip content="Close fullscreen" side="bottom">
            <DialogClose asChild>
              <Button aria-label="Close fullscreen" icon="x" size="icon-xs" type="button" variant="ghost" />
            </DialogClose>
          </Tooltip>
        </header>
        <div className="min-h-0 flex-1">
          <ArtifactWorkbench artifact={artifact} fullscreen />
        </div>
      </DialogContent>
    </Dialog>
  );
}
