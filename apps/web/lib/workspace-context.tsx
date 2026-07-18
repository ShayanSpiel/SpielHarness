"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type WorkspaceInfo = {
  org_id: string;
  org_name: string;
  role: string;
};

type WorkspaceContextValue = {
  workspace: WorkspaceInfo | null;
  switchWorkspace: (orgId: string) => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function getCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split("; ")
    .find((c) => c.startsWith(name + "="))
    ?.split("=")[1];
}

function setCookie(name: string, value: string, maxAge = 60 * 60 * 24 * 365) {
  document.cookie = `${name}=${value}; path=/; max-age=${maxAge}`;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const showedName = useRef(false);

  useEffect(() => {
    if (window.location.pathname === "/login") return;
    const id = getCookie("spielos.org");
    const name = getCookie("spielos.org-name");
    const role = getCookie("spielos.org-role");
    if (id && name) {
      setWorkspace({ org_id: id, org_name: decodeURIComponent(name), role: role ?? "admin" });
    }
    if (!showedName.current) {
      showedName.current = true;
      fetch("/api/orgs", { cache: "no-store" })
        .then((res) => {
          if (res.status === 401) {
            if (window.location.pathname !== "/login") {
              window.location.href = `/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
            }
            return null;
          }
          return res.ok ? res.json() : { orgs: [] };
        })
        .then((data: { orgs?: WorkspaceInfo[] } | null) => {
          if (!data) return;
          const orgList = data.orgs ?? [];
          const cookieId = getCookie("spielos.org");
          const current = orgList.find((o) => o.org_id === cookieId) ?? orgList[0];
          if (current) {
            setWorkspace(current);
            setCookie("spielos.org", current.org_id);
            setCookie("spielos.org-name", encodeURIComponent(current.org_name));
            setCookie("spielos.org-role", current.role);
          }
        })
        .catch(() => {});
    }
  }, []);

  const switchWorkspace = useCallback(async (orgId: string) => {
    if (orgId === workspace?.org_id) return;
    const res = await fetch("/api/org/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId }),
    });
    if (!res.ok) return;
    const data = await res.json() as {
      success: boolean;
      orgId: string;
      orgName: string | null;
      role: string | null;
    };
    const name = data.orgName ?? "Workspace";
    const role = data.role ?? "admin";
    setWorkspace({ org_id: orgId, org_name: name, role });
    setCookie("spielos.org", orgId);
    setCookie("spielos.org-name", encodeURIComponent(name));
    setCookie("spielos.org-role", role);
    window.location.href = window.location.pathname;
  }, [workspace?.org_id]);

  const value = useMemo(() => ({ workspace, switchWorkspace }), [workspace, switchWorkspace]);

  return createElement(WorkspaceContext.Provider, { value }, children);
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within a <WorkspaceProvider>");
  return ctx;
}
