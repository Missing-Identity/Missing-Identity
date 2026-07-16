export const PRIMARY_EMAIL = "unmilanm@gmail.com" as const;

export const STATE_KEYS = {
  dailyOss: "daily-oss-contribution",
  prMaxx: "pr-maxx-automation",
} as const;

export type StagingStatus =
  | "idle"
  | "scouted"
  | "staged"
  | "pushed"
  | "pr_opened"
  | "completed";

export interface BranchRecord {
  repo: string;
  branch: string;
  lastPushAt: string;
  sha?: string;
  prUrl?: string;
}

export interface ScoutingRecord {
  repo: string;
  issueUrl?: string;
  topic?: string;
  scoutedAt: string;
}

export interface EducationalBrief {
  path: string;
  topic: string;
  generatedAt: string;
  emailedAt?: string;
}

export interface AutomationState {
  version: 1;
  lastRunAt?: string;
  stagingStatus: StagingStatus;
  activeBranch?: BranchRecord;
  previousBranches: BranchRecord[];
  scoutingHistory: ScoutingRecord[];
  educationalBriefs: EducationalBrief[];
}

export function createEmptyState(): AutomationState {
  return {
    version: 1,
    stagingStatus: "idle",
    previousBranches: [],
    scoutingHistory: [],
    educationalBriefs: [],
  };
}
