import { readState, writeState } from "@cursor/automation-flow";
import {
  AutomationState,
  BranchRecord,
  EducationalBrief,
  ScoutingRecord,
  StagingStatus,
  createEmptyState,
} from "./types.js";

export async function loadAutomationState(
  stateKey: string,
): Promise<AutomationState> {
  const persisted = await readState<AutomationState>(stateKey);
  if (!persisted || persisted.version !== 1) {
    return createEmptyState();
  }
  return persisted;
}

export async function saveAutomationState(
  stateKey: string,
  state: AutomationState,
): Promise<void> {
  state.lastRunAt = new Date().toISOString();
  await writeState(state, stateKey);
}

export function findFollowUpBranch(
  state: AutomationState,
): BranchRecord | undefined {
  if (!state.activeBranch) {
    return undefined;
  }

  const terminal: StagingStatus[] = ["completed", "idle"];
  if (terminal.includes(state.stagingStatus)) {
    return undefined;
  }

  return state.activeBranch;
}

export function findResumableBranch(
  state: AutomationState,
): BranchRecord | undefined {
  const followUp = findFollowUpBranch(state);
  if (followUp) {
    return followUp;
  }

  return state.previousBranches.find(
    (record) => record.branch && !record.prUrl,
  );
}

export function recordScouting(
  state: AutomationState,
  record: ScoutingRecord,
): AutomationState {
  const scoutingHistory = [
    record,
    ...state.scoutingHistory.filter((entry) => entry.repo !== record.repo),
  ].slice(0, 20);

  return {
    ...state,
    stagingStatus: "scouted",
    scoutingHistory,
  };
}

export function recordStaging(
  state: AutomationState,
  branch: BranchRecord,
): AutomationState {
  const previousBranches = state.activeBranch
    ? [state.activeBranch, ...state.previousBranches]
    : state.previousBranches;

  return {
    ...state,
    stagingStatus: "staged",
    activeBranch: branch,
    previousBranches: dedupeBranches(previousBranches).slice(0, 20),
  };
}

export function recordPush(
  state: AutomationState,
  branch: BranchRecord,
): AutomationState {
  return {
    ...state,
    stagingStatus: "pushed",
    activeBranch: branch,
    previousBranches: dedupeBranches([
      branch,
      ...state.previousBranches.filter((b) => b.branch !== branch.branch),
    ]).slice(0, 20),
  };
}

export function recordEducationalBrief(
  state: AutomationState,
  brief: EducationalBrief,
): AutomationState {
  return {
    ...state,
    educationalBriefs: [
      brief,
      ...state.educationalBriefs.filter((b) => b.path !== brief.path),
    ].slice(0, 30),
  };
}

export function markBriefEmailed(
  state: AutomationState,
  briefPath: string,
): AutomationState {
  return {
    ...state,
    educationalBriefs: state.educationalBriefs.map((brief) =>
      brief.path === briefPath
        ? { ...brief, emailedAt: new Date().toISOString() }
        : brief,
    ),
  };
}

export function alreadyScoutedRecently(
  state: AutomationState,
  repo: string,
  withinHours = 24,
): boolean {
  const entry = state.scoutingHistory.find((record) => record.repo === repo);
  if (!entry) {
    return false;
  }

  const scoutedAt = Date.parse(entry.scoutedAt);
  if (Number.isNaN(scoutedAt)) {
    return false;
  }

  return Date.now() - scoutedAt < withinHours * 60 * 60 * 1000;
}

function dedupeBranches(branches: BranchRecord[]): BranchRecord[] {
  const seen = new Set<string>();
  const deduped: BranchRecord[] = [];

  for (const branch of branches) {
    const key = `${branch.repo}:${branch.branch}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(branch);
  }

  return deduped;
}
