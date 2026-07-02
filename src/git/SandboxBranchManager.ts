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
   * Relies on execFileSync to safely escape arguments and handle platform variances.
   */
  private runGit(args: string[]): string {
    try {
      return execFileSync("git", args, {
        cwd: this.workingDir,
        encoding: "utf8",
        stdio: "pipe",
      }).trim();
    } catch (error: any) {
      const stderr = error.stderr?.toString().trim() || error.message;
      throw new Error(
        `Git command failed: git ${args.join(" ")}. Error: ${stderr}`,
      );
    }
  }

  /**
   * Stashes any uncommitted workspace modifications and creates/checks out
   * an isolated tracking branch named `agent/[taskId]`.
   *
   * @param taskId - The unique task UUID used to name the sandbox branch.
   * @throws Error if the workspace is not a valid Git repository or if a command fails.
   */
  public async applySandboxBranch(taskId: string): Promise<void> {
    // 1. Validate that the working directory is indeed a Git repository
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

    // 2. Check for uncommitted modifications (tracked, unstaged, and untracked files)
    const status = this.runGit(["status", "--porcelain"]);
    if (status) {
      // Stash modifications safely. The '-u' flag includes untracked files, ensuring a completely clean status
      this.runGit(["stash", "push", "-u", "-m", `nexus-backup: ${taskId}`]);
    }

    // 3. Create and check out the new isolated tracking branch
    this.runGit(["checkout", "-b", `agent/${taskId}`]);
  }
}
