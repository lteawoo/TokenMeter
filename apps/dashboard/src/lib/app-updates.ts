export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "latest"
  | "update-available"
  | "offline";

export type AppUpdateState = {
  status: AppUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  checkedAt: string | null;
  message: string | null;
  homebrewUpgradeCommand: string;
};

const DEFAULT_RELEASE_URL = "https://github.com/lteawoo/TokenMeter/releases/latest";
const DEFAULT_HOMEBREW_COMMAND = "brew update && brew upgrade --cask tokenmeter";

export function createInitialAppUpdateState(currentVersion: string): AppUpdateState {
  return {
    status: "idle",
    currentVersion,
    latestVersion: null,
    releaseUrl: DEFAULT_RELEASE_URL,
    checkedAt: null,
    message: null,
    homebrewUpgradeCommand: DEFAULT_HOMEBREW_COMMAND,
  };
}

export function getAppUpdateStatusLabel(status: AppUpdateStatus) {
  switch (status) {
    case "checking":
      return "CHECKING";
    case "latest":
      return "LATEST";
    case "update-available":
      return "UPDATE AVAILABLE";
    case "offline":
      return "OFFLINE";
    case "idle":
    default:
      return "CHECK UPDATES";
  }
}

export function shouldShowCompactUpdateCard(state: AppUpdateState) {
  return state.status === "checking" || state.status === "update-available" || state.status === "offline";
}
