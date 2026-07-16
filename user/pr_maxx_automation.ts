import { git, runAgent } from "@cursor/automation-flow";
import { emailEducationalBrief } from "./email_helpers.js";
import {
  findFollowUpBranch,
  findResumableBranch,
  loadAutomationState,
  recordEducationalBrief,
  recordPush,
  recordStaging,
  saveAutomationState,
} from "./state_helpers.js";
import { STATE_KEYS, type BranchRecord } from "./types.js";

const BRIEF_PATH = "user/briefs/pr-maxx-educational-brief.md";

/**
 * PR Maxx automation — deep PR review, polish, and educational output.
 *
 * Root causes fixed:
 * - Did not read/write automation state, so pushes on prior branches were not followed up.
 * - Re-ran full PR workflow from scratch on every trigger instead of resuming staged work.
 * - Email step omitted attachments / targeted wrong recipient for markdown briefs.
 */
export async function runPrMaxxAutomation(): Promise<void> {
  const stateKey = STATE_KEYS.prMaxx;
  let state = await loadAutomationState(stateKey);
  const gitStatus = await git.status();
  const repo =
    process.env.PR_MAXX_REPO ??
    state.activeBranch?.repo ??
    "Missing-Identity/Missing-Identity";

  const priorBranch = findFollowUpBranch(state) ?? findResumableBranch(state);

  if (priorBranch) {
    await followUpPriorPush(stateKey, state, priorBranch, gitStatus.branch);
    return;
  }

  const branchName =
    gitStatus.branch.startsWith("cursor/") || gitStatus.branch.startsWith("pr-maxx/")
      ? gitStatus.branch
      : `cursor/pr-maxx-${new Date().toISOString().slice(0, 10)}`;

  const branchRecord: BranchRecord = {
    repo,
    branch: branchName,
    lastPushAt: new Date().toISOString(),
    sha: gitStatus.sha,
  };

  state = recordStaging(state, branchRecord);
  await saveAutomationState(stateKey, state);

  const maxxResult = await runAgent(
    [
      "Run a Max Mode PR polish pass on the current branch.",
      `Repository: ${repo}`,
      `Branch: ${branchName}`,
      "Improve tests, docs, and type safety; keep the diff focused.",
      "Commit, push, and open or update the PR.",
      `Write a detailed educational markdown brief to ${BRIEF_PATH} covering architecture, tradeoffs, and review notes.`,
    ].join("\n"),
    { repo, branch: branchName, model: "default" },
  );

  if (maxxResult.status !== "finished") {
    throw new Error(`PR Maxx agent failed: ${maxxResult.status}`);
  }

  state = recordPush(state, {
    ...branchRecord,
    lastPushAt: new Date().toISOString(),
    sha: gitStatus.sha,
    prUrl: maxxResult.prUrl,
  });

  state = recordEducationalBrief(state, {
    path: BRIEF_PATH,
    topic: "pr-maxx",
    generatedAt: new Date().toISOString(),
  });
  await saveAutomationState(stateKey, state);

  state = await emailEducationalBrief(state, {
    subject: `[PR Maxx] Educational brief — ${branchName}`,
    markdownPath: BRIEF_PATH,
    intro: "Your PR Maxx educational brief is attached in full.",
  });

  await saveAutomationState(stateKey, {
    ...state,
    stagingStatus: maxxResult.prUrl ? "pr_opened" : "pushed",
  });
}

async function followUpPriorPush(
  stateKey: string,
  state: Awaited<ReturnType<typeof loadAutomationState>>,
  branch: BranchRecord,
  currentBranch: string,
): Promise<void> {
  await saveAutomationState(stateKey, {
    ...state,
    activeBranch: branch,
    stagingStatus: branch.prUrl ? "pr_opened" : "pushed",
  });

  const remoteBranches = await git.listBranches({ remote: true });
  const branchStillExists =
    remoteBranches.includes(branch.branch) ||
    remoteBranches.includes(`origin/${branch.branch}`) ||
    currentBranch === branch.branch;

  const followUpResult = await runAgent(
    [
      "Follow up on the prior PR Maxx branch instead of creating a new one.",
      `Repository: ${branch.repo}`,
      `Prior branch: ${branch.branch}`,
      `Current branch: ${currentBranch}`,
      branchStillExists
        ? "The prior branch still exists remotely — continue on it."
        : "Prior branch may be gone — recreate work from the last known state.",
      branch.prUrl ? `PR: ${branch.prUrl}` : "No PR URL recorded yet.",
      "Address review comments, CI failures, and push fixes.",
      `Refresh ${BRIEF_PATH} with updated educational notes.`,
    ].join("\n"),
    { repo: branch.repo, branch: branch.branch },
  );

  if (followUpResult.status !== "finished") {
    throw new Error(`PR Maxx follow-up failed: ${followUpResult.status}`);
  }

  let nextState = recordPush(state, {
    ...branch,
    lastPushAt: new Date().toISOString(),
    prUrl: followUpResult.prUrl ?? branch.prUrl,
  });

  nextState = recordEducationalBrief(nextState, {
    path: BRIEF_PATH,
    topic: "pr-maxx-follow-up",
    generatedAt: new Date().toISOString(),
  });
  await saveAutomationState(stateKey, nextState);

  nextState = await emailEducationalBrief(nextState, {
    subject: `[PR Maxx] Follow-up brief — ${branch.branch}`,
    markdownPath: BRIEF_PATH,
    intro: "Follow-up PR Maxx educational brief attached.",
  });

  await saveAutomationState(stateKey, {
    ...nextState,
    stagingStatus: followUpResult.prUrl ?? branch.prUrl ? "pr_opened" : "pushed",
  });
}

export default runPrMaxxAutomation;
