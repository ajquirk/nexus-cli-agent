// src/git/GitValidator.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitValidatorInterface {
  /**
   * Asserts whether the given directory path is an active, valid Git repository.
   *
   * @param workspacePath - The physical path of the workspace directory to check.
   * @returns A promise resolving to true if valid, or false otherwise.
   */
  isGitRepository(workspacePath: string): Promise<boolean>;
}

export class GitValidator implements GitValidatorInterface {
  /**
   * Asserts whether the given directory path is an active, valid Git repository.
   *
   * Runs the low-overhead command `git rev-parse --is-inside-work-tree`
   * within the target directory context.
   *
   * @param workspacePath - The absolute or relative target directory path.
   * @returns A promise that resolves to true if the directory is a valid Git repository, or false otherwise.
   */
  async isGitRepository(workspacePath: string): Promise<boolean> {
    try {
      // Execute git command with restricted argument scope inside the target workspace
      await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: workspacePath,
      });
      return true;
    } catch {
      // Catch execution failures (non-zero exit codes), missing path issues, or missing binary errors
      return false;
    }
  }
}
