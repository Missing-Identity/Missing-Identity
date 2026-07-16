/**
 * Ambient types for Cursor Automation Flow runtime tools.
 * These functions are injected by the automation executor at runtime.
 */
declare module "@cursor/automation-flow" {
  export interface EmailAttachment {
    filename: string;
    content: string;
    contentType?: string;
  }

  export interface SendEmailOptions {
    to: string | string[];
    subject: string;
    body?: string;
    html?: string;
    attachments?: EmailAttachment[];
  }

  export interface RunAgentOptions {
    model?: string;
    repo?: string;
    branch?: string;
  }

  export interface RunAgentResult {
    status: "finished" | "error" | "cancelled";
    result?: string;
    branch?: string;
    prUrl?: string;
  }

  /** Read persisted automation state for the current flow. */
  export function readState<T = unknown>(key?: string): Promise<T | null>;

  /** Persist automation state for follow-up runs. */
  export function writeState<T = unknown>(state: T, key?: string): Promise<void>;

  /** Send email with optional markdown attachments. */
  export function sendEmail(options: SendEmailOptions): Promise<void>;

  /** Invoke a cloud agent sub-task. */
  export function runAgent(
    prompt: string,
    options?: RunAgentOptions,
  ): Promise<RunAgentResult>;

  /** Read a workspace file (relative to repo root). */
  export function readFile(path: string): Promise<string>;

  /** Write a workspace file (relative to repo root). */
  export function writeFile(path: string, content: string): Promise<void>;

  export interface GitStatus {
    branch: string;
    remote?: string;
    sha?: string;
    isClean: boolean;
  }

  export const git: {
    status(): Promise<GitStatus>;
    listBranches(options?: { remote?: boolean }): Promise<string[]>;
  };
}
