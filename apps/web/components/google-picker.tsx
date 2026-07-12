"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@spielos/design-system";
import { Icon } from "@spielos/design-system/components";

export type PickedFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  iconUrl: string;
  webViewLink: string;
};

type GooglePickerProps = {
  accessToken: string;
  appId?: string;
  onSelect: (files: PickedFile[]) => void;
  onError?: (error: Error) => void;
  disabled?: boolean;
};

declare global {
  interface Window {
    gapi?: {
      load: (api: string, callback: () => void) => void;
    };
    google?: {
      picker?: {
        PickerBuilder: new () => PickerBuilderInstance;
        ViewId: Record<string, unknown>;
      };
    };
  }
}

interface PickerBuilderInstance {
  setOAuthToken(token: string): PickerBuilderInstance;
  setAppId(id: string): PickerBuilderInstance;
  addView(view: unknown): PickerBuilderInstance;
  setCallback(cb: (data: Record<string, unknown>) => void): PickerBuilderInstance;
  build(): { setVisible: (v: boolean) => void };
}

function waitForGapi(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (window.gapi) {
        window.gapi.load("picker", () => resolve());
      } else {
        setTimeout(check, 100);
      }
    };
    const existing = document.querySelector(
      'script[src="https://apis.google.com/js/api.js"]'
    );
    if (existing) {
      check();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.defer = true;
    script.onload = check;
    document.body.appendChild(script);
  });
}

export function GooglePicker({
  accessToken,
  appId = "447259138795",
  onSelect,
  onError,
  disabled
}: GooglePickerProps) {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    waitForGapi()
      .then(() => setReady(true))
      .catch(() => {});
  }, []);

  const openPicker = useCallback(() => {
    const google = window.google;
    if (!google?.picker) {
      onError?.(new Error("Google Picker not loaded"));
      return;
    }

    setOpen(true);

    const picker = new google.picker.PickerBuilder()
      .setOAuthToken(accessToken)
      .setAppId(appId)
      .addView(google.picker.ViewId.DOCS)
      .addView(google.picker.ViewId.DOCS_IMAGES)
      .addView(google.picker.ViewId.DOCS_VIDEOS)
      .addView(google.picker.ViewId.FOLDERS)
      .addView(google.picker.ViewId.PDF)
      .setCallback((data: Record<string, unknown>) => {
        setOpen(false);
        if (data.action === "picked" && Array.isArray(data.docs)) {
          const files: PickedFile[] = data.docs.map((doc: Record<string, unknown>) => ({
            id: String(doc.id ?? ""),
            name: String(doc.name ?? ""),
            mimeType: String(doc.mimeType ?? ""),
            sizeBytes: Number(doc.sizeBytes) || 0,
            iconUrl: String(doc.iconUrl ?? ""),
            webViewLink: String(doc.url ?? "")
          }));
          onSelect(files);
        }
      })
      .build();

    picker.setVisible(true);
  }, [accessToken, appId, onSelect, onError]);

  return (
    <Button
      className="h-7 px-2"
      disabled={disabled || !ready || open}
      onClick={openPicker}
      size="sm"
      variant="ghost"
    >
      <Icon name="cloud" size={14} />
      <span className="ml-1 text-xs">
        {open ? "Opening..." : "Pick files"}
      </span>
    </Button>
  );
}
