import { execFileSync } from "node:child_process";

export interface SandboxBranchManagerOptions {
  /**
   * The working directory where Git commands will be executed.
   * Defaults to process.cwd() if not provided.
   */
  workingDir?: string;
}

export class SandboxBranchManager {
  private workingDir: string;

  constructor(options?: SandboxBranchManagerOptions) {
    this.workingDir = options?.workingDir ?? process.cwd();
  }

  /**
   * Executes a Git command inside the designated working directory.
   */
  private runGit(args: string[]): string {
    try {
      return execFileSync("git", args, {
        cwd: this.workingDir,
        encoding: "utf8",
        stdio: "pipe",
      }).trim();
    } catch (error: any) {
      const stderr = error.stderr?.toString().trim() || "";
      const stdout = error.stdout?.toString().trim() || "";
      const details =
        [stderr, stdout].filter(Boolean).join("\n") || error.message;
      throw new Error(
        `Git command failed: git ${args.join(" ")}. Error: ${details}`,
      );
    }
  }

  /**
   * Checks if the agent's temporary sandbox branch exists in local refs.
   */
  private sandboxBranchExists(taskId: string): boolean {
    try {
      const output = this.runGit(["branch", "--list", `agent/${taskId}`]);
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Stashes any uncommitted workspace modifications and creates/checks out
   * an isolated tracking branch named `agent/[taskId]`.
   */
  public async applySandboxBranch(taskId: string): Promise<void> {
    try {
      execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: this.workingDir,
        stdio: "ignore",
      });
    } catch {
      throw new Error(
        `The directory "${this.workingDir}" is not a valid Git repository.`,
      );
    }

    const status = this.runGit(["status", "--porcelain"]);
    if (status) {
      this.runGit(["stash", "push", "-u", "-m", `nexus-backup: ${taskId}`]);
    }

    this.runGit(["checkout", "-b", `agent/${taskId}`]);
  }

  /**
   * Discards the experimental changes made on the agent branch,
   * switches back to the original branch, deletes the sandbox branch,
   * and restores any stashed uncommitted changes.
   */
  public async restoreOriginalBranch(taskId: string): Promise<void> {
    // If the sandbox branch doesn't exist, we may have already restored or never created it.
    // Try to restore any remaining matching stashes for robustness and exit early.
    if (!this.sandboxBranchExists(taskId)) {
      this.popStashForTask(taskId);
      return;
    }

    const originalBranch = this.findOriginalBranch(taskId);
    let currentBranch = "";

    try {
      currentBranch = this.runGit(["branch", "--show-current"]);
    } catch {
      // Fallback
    }

    // Reset tracked modifications and remove untracked files if we are on the sandbox branch
    if (currentBranch === `agent/${taskId}`) {
      try {
        this.runGit(["reset", "--hard", "HEAD"]);
        this.runGit(["clean", "-fd"]);
      } catch {
        // Ignore reset failures
      }
    }

    // Checkout the original branch
    this.runGit(["checkout", originalBranch]);

    // Delete the sandbox branch
    try {
      this.runGit(["branch", "-D", `agent/${taskId}`]);
    } catch {
      // Ignore if already deleted
    }

    // Restore stashed workspace modifications
    this.popStashForTask(taskId);
  }

  /**
   * Merges the successfully validated sandbox branch back into the
   * original branch, deletes the sandbox branch, and restores stashed changes.
   */
  public async mergeSandboxBranch(taskId: string): Promise<void> {
    // If the sandbox branch has already been merged and deleted, exit early
    if (!this.sandboxBranchExists(taskId)) {
      this.popStashForTask(taskId);
      return;
    }

    const originalBranch = this.findOriginalBranch(taskId);
    let currentBranch = "";

    try {
      currentBranch = this.runGit(["branch", "--show-current"]);
    } catch {
      // Fallback
    }

    if (currentBranch === `agent/${taskId}`) {
      this.runGit(["checkout", originalBranch]);
    }

    // Perform the merge
    this.runGit(["merge", "--ff-only", `agent/${taskId}`]);

    // Delete the sandbox branch
    try {
      this.runGit(["branch", "-D", `agent/${taskId}`]);
    } catch {
      // Ignore if already deleted
    }

    // Restore the developer's original stashed modifications
    this.popStashForTask(taskId);
  }

  /**
   * Scans the Git reflog and stash registers to deterministically identify
   * the active branch the developer was on before the agent execution loop started.
   */
  private findOriginalBranch(taskId: string): string {
    try {
      const reflog = this.runGit(["reflog", "-n", "100"]);
      const lines = reflog.split("\n");
      const pattern = new RegExp(
        `checkout: moving from (\\S+) to agent/${taskId}`,
      );
      for (const line of lines) {
        const match = line.match(pattern);
        if (match && match[1]) {
          return match[1];
        }
      }
    } catch {
      // Ignore
    }

    try {
      const stashList = this.runGit(["stash", "list"]);
      const lines = stashList.split("\n");
      const pattern = new RegExp(
        `stash@\\{\\d+\\}: On (\\S+): nexus-backup: ${taskId}`,
      );
      for (const line of lines) {
        const match = line.match(pattern);
        if (match && match[1]) {
          return match[1];
        }
      }
    } catch {
      // Ignore
    }

    try {
      const branchesOutput = this.runGit(["branch"]);
      const branches = branchesOutput
        .split("\n")
        .map((b) => b.replace("*", "").trim())
        .filter((b) => b && !b.startsWith("agent/"));
      if (branches.includes("main")) return "main";
      if (branches.includes("master")) return "master";
      if (branches.length > 0) return branches[0];
    } catch {
      // Ignore
    }

    return "main";
  }

  /**
   * Identifies the exact stash entry matching the sandbox task ID and pops it back
   * into the active working copy. Handles merge conflicts gracefully.
   */
  private popStashForTask(taskId: string): void {
    let stashIndex = "";
    try {
      const stashList = this.runGit(["stash", "list"]);
      if (!stashList) return;

      const lines = stashList.split("\n");
      const pattern = new RegExp(
        `stash@\\{(\\d+)\\}:.*nexus-backup: ${taskId}`,
      );
      for (const line of lines) {
        const match = line.match(pattern);
        if (match) {
          stashIndex = `stash@{${match[1]}}`;
          break;
        }
      }

      if (!stashIndex) {
        return; // No matching stash to pop
      }

      this.runGit(["stash", "pop", stashIndex]);
    } catch (error: any) {
      const stderr = error.message || "";
      if (
        stderr.includes("conflict") ||
        stderr.includes("CONFLICT") ||
        stderr.includes("merge")
      ) {
        throw new Error(
          `Stash pop resulted in a merge conflict for task ${taskId}. ` +
            `Your local modifications have been restored with conflict markers, but the stash entry ` +
            `(${stashIndex}) has been preserved. Please resolve the conflicts manually and run ` +
            `'git stash drop' once you are finished.`,
        );
      }
      throw new Error(`Failed to restore stashed changes: ${stderr}`);
    }
  }
}
