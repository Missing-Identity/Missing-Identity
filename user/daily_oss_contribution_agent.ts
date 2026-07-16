import { git, runAgent, writeFile } from "@cursor/automation-flow";
import { emailEducationalBrief } from "./email_helpers.js";
import {
  alreadyScoutedRecently,
  findFollowUpBranch,
  findResumableBranch,
  loadAutomationState,
  recordEducationalBrief,
  recordPush,
  recordScouting,
  recordStaging,
  saveAutomationState,
} from "./state_helpers.js";
import { STATE_KEYS, type BranchRecord } from "./types.js";

const BRIEF_PATH = "user/briefs/daily-oss-educational-brief.md";

/**
 * Daily OSS contribution automation.
 *
 * Root causes fixed:
 * - Previously started fresh each run without readState, so prior branches were ignored.
 * - Scouting/staging actions were never persisted via writeState.
 * - Educational brief markdown was not emailed to the primary inbox.
 */
export async function runDailyOssContributionAgent(): Promise<void> {
  const stateKey = STATE_KEYS.dailyOss;
  let state = await loadAutomationState(stateKey);

  const followUpBranch = findFollowUpBranch(state) ?? findResumableBranch(state);
  const gitStatus = await git.status();

  if (followUpBranch) {
    state = await followUpOnPriorBranch(state, stateKey, followUpBranch, gitStatus.branch);
    return;
  }

  const targetRepo = process.env.OSS_TARGET_REPO ?? "Missing-Identity/Missing-Identity";

  if (alreadyScoutedRecently(state, targetRepo)) {
    state = await continueFromRecentScouting(state, stateKey, targetRepo, gitStatus.branch);
    return;
  }

  state = recordScouting(state, {
    repo: targetRepo,
    scoutedAt: new Date().toISOString(),
    topic: "daily-oss-contribution",
  });
  await saveAutomationState(stateKey, state);

  const scoutResult = await runAgent(
    [
      "Scout one approachable open-source contribution opportunity.",
      `Target repository: ${targetRepo}.`,
      "Prefer good-first-issue or documentation fixes.",
      "Return: repo, issue URL, suggested branch name, and a one-paragraph plan.",
    ].join("\n"),
    { repo: targetRepo },
  );

  if (scoutResult.status !== "finished") {
    throw new Error(`OSS scouting agent failed: ${scoutResult.status}`);
  }

  const branchName =
    scoutResult.branch ??
    `cursor/daily-oss-${new Date().toISOString().slice(0, 10)}`;

  const branchRecord: BranchRecord = {
    repo: targetRepo,
    branch: branchName,
    lastPushAt: new Date().toISOString(),
    sha: gitStatus.sha,
  };

  state = recordStaging(state, branchRecord);
  await saveAutomationState(stateKey, state);

  const implementationResult = await runAgent(
    [
      "Implement the scouted OSS contribution on the current branch.",
      `Continue on branch ${branchName}.`,
      "Make a focused change, commit, and push.",
      `Write an educational brief markdown file to ${BRIEF_PATH} explaining what you changed and why.`,
    ].join("\n"),
    { repo: targetRepo, branch: branchName },
  );

  if (implementationResult.status !== "finished") {
    throw new Error(`OSS implementation agent failed: ${implementationResult.status}`);
  }

  state = recordPush(state, {
    ...branchRecord,
    lastPushAt: new Date().toISOString(),
    sha: gitStatus.sha,
    prUrl: implementationResult.prUrl,
  });

  state = recordEducationalBrief(state, {
    path: BRIEF_PATH,
    topic: "daily-oss-contribution",
    generatedAt: new Date().toISOString(),
  });
  await saveAutomationState(stateKey, state);

  state = await emailEducationalBrief(state, {
    subject: `[Daily OSS] Educational brief — ${new Date().toISOString().slice(0, 10)}`,
    markdownPath: BRIEF_PATH,
    intro: "Your daily OSS contribution educational brief is attached.",
  });

  await saveAutomationState(stateKey, {
    ...state,
    stagingStatus: implementationResult.prUrl ? "pr_opened" : "pushed",
  });
}

async function followUpOnPriorBranch(
  state: Awaited<ReturnType<typeof loadAutomationState>>,
  stateKey: string,
  branch: BranchRecord,
  currentBranch: string,
): Promise<Awaited<ReturnType<typeof loadAutomationState>>> {
  await saveAutomationState(stateKey, {
    ...state,
    stagingStatus: state.stagingStatus === "idle" ? "staged" : state.stagingStatus,
    activeBranch: branch,
  });

  const followUpResult = await runAgent(
    [
      "Follow up on the existing OSS contribution work instead of starting over.",
      `Repository: ${branch.repo}`,
      `Prior branch: ${branch.branch}`,
      `Current checked-out branch: ${currentBranch}`,
      `Last push: ${branch.lastPushAt}`,
      branch.prUrl ? `Existing PR: ${branch.prUrl}` : "No PR opened yet.",
      "Check CI/review feedback, push any fixes, and update the educational brief.",
      `Ensure ${BRIEF_PATH} reflects the latest changes.`,
    ].join("\n"),
    { repo: branch.repo, branch: branch.branch },
  );

  if (followUpResult.status !== "finished") {
    throw new Error(`OSS follow-up agent failed: ${followUpResult.status}`);
  }

  let nextState = recordPush(state, {
    ...branch,
    lastPushAt: new Date().toISOString(),
    prUrl: followUpResult.prUrl ?? branch.prUrl,
  });

  nextState = recordEducationalBrief(nextState, {
    path: BRIEF_PATH,
    topic: "daily-oss-contribution-follow-up",
    generatedAt: new Date().toISOString(),
  });
  await saveAutomationState(stateKey, nextState);

  nextState = await emailEducationalBrief(nextState, {
    subject: `[Daily OSS] Follow-up brief — ${branch.branch}`,
    markdownPath: BRIEF_PATH,
    intro: "Follow-up educational brief for your in-progress OSS contribution is attached.",
  });

  await saveAutomationState(stateKey, {
    ...nextState,
    stagingStatus: followUpResult.prUrl ? "pr_opened" : "pushed",
  });

  return nextState;
}

async function continueFromRecentScouting(
  state: Awaited<ReturnType<typeof loadAutomationState>>,
  stateKey: string,
  repo: string,
  currentBranch: string,
): Promise<Awaited<ReturnType<typeof loadAutomationState>>> {
  const recentScout = state.scoutingHistory.find((entry) => entry.repo === repo);
  const branchName =
    state.activeBranch?.branch ??
    `cursor/daily-oss-${new Date().toISOString().slice(0, 10)}`;

  const branchRecord: BranchRecord = {
    repo,
    branch: branchName,
    lastPushAt: new Date().toISOString(),
  };

  state = recordStaging(state, branchRecord);
  await saveAutomationState(stateKey, state);

  const resumeResult = await runAgent(
    [
      "Resume staging work from a recent scouting run; do not re-scout the repository.",
      `Repository: ${repo}`,
      `Current branch: ${currentBranch}`,
      recentScout?.issueUrl ? `Prior issue: ${recentScout.issueUrl}` : "",
      `Write or update ${BRIEF_PATH} with an educational summary.`,
    ]
      .filter(Boolean)
      .join("\n"),
    { repo, branch: branchName },
  );

  if (resumeResult.status !== "finished") {
    throw new Error(`OSS resume agent failed: ${resumeResult.status}`);
  }

  let nextState = recordPush(state, {
    ...branchRecord,
    prUrl: resumeResult.prUrl,
  });

  await writeFile(
    BRIEF_PATH,
    `# Daily OSS Educational Brief\n\n_Resumed from scouting on ${recentScout?.scoutedAt ?? "unknown"}_\n`,
  );

  nextState = recordEducationalBrief(nextState, {
    path: BRIEF_PATH,
    topic: "daily-oss-contribution-resume",
    generatedAt: new Date().toISOString(),
  });

  nextState = await emailEducationalBrief(nextState, {
    subject: `[Daily OSS] Resumed scouting brief — ${branchName}`,
    markdownPath: BRIEF_PATH,
  });

  await saveAutomationState(stateKey, nextState);
  return nextState;
}

// Automation flow entrypoint
export default runDailyOssContributionAgent;
