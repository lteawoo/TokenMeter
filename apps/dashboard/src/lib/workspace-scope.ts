import type { CodexSessionSummary } from "@tokenmeter/core";

export const ALL_WORKSPACES_VALUE = "all";

export type WorkspaceScopeSummary = {
  value: string;
  label: string;
  path: string;
  sessionCount: number;
  latestUpdatedAt: string;
  hasActiveSession: boolean;
  isLatest: boolean;
};

export function getWorkspaceValue(session: CodexSessionSummary) {
  return session.cwd ?? session.filePath;
}

export function getWorkspaceLabel(path: string) {
  return path.split("/").filter(Boolean).slice(-2).join("/") || path;
}

export function buildWorkspaceScopeSummaries(
  sessions: CodexSessionSummary[],
): WorkspaceScopeSummary[] {
  const summaryMap = new Map<string, WorkspaceScopeSummary>();

  sessions.forEach((session, index) => {
    const path = getWorkspaceValue(session);
    const existing = summaryMap.get(path);

    if (!existing) {
      summaryMap.set(path, {
        value: path,
        label: getWorkspaceLabel(path),
        path,
        sessionCount: 1,
        latestUpdatedAt: session.updatedAt,
        hasActiveSession: session.status === "active",
        isLatest: index === 0,
      });
      return;
    }

    existing.sessionCount += 1;
    existing.hasActiveSession = existing.hasActiveSession || session.status === "active";

    if (session.updatedAt > existing.latestUpdatedAt) {
      existing.latestUpdatedAt = session.updatedAt;
    }
  });

  return Array.from(summaryMap.values()).sort(
    (left, right) =>
      new Date(right.latestUpdatedAt).getTime() - new Date(left.latestUpdatedAt).getTime(),
  );
}
