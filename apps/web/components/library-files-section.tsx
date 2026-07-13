"use client";

import { useEffect, useState } from "react";
import { Button, EmptyState } from "@spielos/design-system";
import { Icon } from "@spielos/design-system/components";
import { GoogleDrivePicker } from "./google-drive-picker";

interface DriveStatus {
  connected: boolean;
  account?: string | null;
}

export function LibraryFilesSection() {
  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null);

  useEffect(() => {
    fetch("/api/google-drive/status")
      .then((res) => res.json())
      .then((data: DriveStatus) => setDriveStatus(data))
      .catch(() => setDriveStatus({ connected: false }));
  }, []);

  if (driveStatus === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Icon name="loader" size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (driveStatus.connected) {
    return <GoogleDrivePicker />;
  }

  return (
    <EmptyState
      className="h-full"
      icon={<Icon name="folder" size={24} />}
      title="Google Drive"
      description="Connect Google Drive to browse, search, and import workspace files. You can manage the connection later in Settings."
      action={
        <Button
          icon="lock"
          onClick={() => {
            window.location.href = "/api/auth/google?integration=google-drive";
          }}
          size="md"
          variant="primary"
        >
          Connect Google Drive
        </Button>
      }
    />
  );
}
