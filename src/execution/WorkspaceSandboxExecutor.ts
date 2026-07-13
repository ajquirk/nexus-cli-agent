import { SandboxBranchManager } from "../git/SandboxBranchManager.js";
import { PatchExecutor, SearchReplaceBlock } from "../patch/PatchExecutor.js";
import {
  SafeCommandExecutor,
  CommandExecutionResult,
} from "./SafeCommandExecutor.js";

export type SearchReplacePatch = SearchReplaceBlock;

export interface WorkspaceSandboxExecutorOptions {
  sandboxBranchManager: SandboxBranchManager;
  patchExecutor: PatchExecutor;
  safeCommandExecutor: SafeCommandExecutor;
}

/**
 * Acts as a transactional controller that coordinates Sandbox Git environments,
 * applying line-by-line file updates, and executing safety verification tests [Option B].
 */
export class WorkspaceSandboxExecutor {
  private activeTasks = new Set<string>();

  constructor(private options: WorkspaceSandboxExecutorOptions) {}

  /**
   * Initializes the transaction session by setting up an isolated branch,
   * stashing current modifications, and tracking transaction state.
   * If setup fails, a rollback is executed to restore the working directory.
   */
  public async initializeWorkspace(taskId: string): Promise<void> {
    if (this.activeTasks.has(taskId)) {
      throw new Error(`Transaction already active for task: ${taskId}`);
    }

    try {
      await this.options.sandboxBranchManager.applySandboxBranch(taskId);
      this.activeTasks.add(taskId);
    } catch (error) {
      // Trigger rollback procedure on any initialization error
      try {
        await this.options.sandboxBranchManager.restoreOriginalBranch(taskId);
      } catch (rollbackError) {
        // Suppress rollback-specific exceptions to avoid masking the primary setup failure
      }
      throw error;
    }
  }

  /**
   * Delegates file modification (patching) to the underlying PatchExecutor.
   * If patching fails, triggers an automatic rollback of the workspace state.
   */
  public async executeModification(
    taskId: string,
    patch: SearchReplacePatch,
  ): Promise<void> {
    if (!this.activeTasks.has(taskId)) {
      throw new Error(`Transaction not active for task: ${taskId}`);
    }

    try {
      await this.options.patchExecutor.applyPatch(patch);
    } catch (error) {
      try {
        await this.finalizeWorkspace(taskId, false);
      } catch (rollbackError) {
        // Suppress secondary rollback failures to preserve primary error
      }
      throw error;
    }
  }

  /**
   * Delegates command-line verification suites to the SafeCommandExecutor.
   * Verifies that the check completed successfully (exitCode: 0). If exitCode
   * is non-zero, throws an error and triggers an automatic rollback.
   */
  public async executeVerification(
    taskId: string,
    templateKey: string,
    variables: Record<string, string>,
  ): Promise<CommandExecutionResult> {
    if (!this.activeTasks.has(taskId)) {
      throw new Error(`Transaction not active for task: ${taskId}`);
    }

    try {
      const result = await this.options.safeCommandExecutor.executeCommand(
        templateKey,
        variables,
      );
      if (result.exitCode !== 0) {
        throw new Error(
          `Verification command failed with exit code ${result.exitCode}`,
        );
      }
      return result;
    } catch (error) {
      try {
        await this.finalizeWorkspace(taskId, false);
      } catch (rollbackError) {
        // Suppress secondary rollback failures to preserve primary error
      }
      throw error;
    }
  }

  /**
   * Finalizes the workspace transaction. Either merges (commits) sandbox branch
   * modifications or restores (rolls back) the workspace to its original branch state.
   */
  public async finalizeWorkspace(
    taskId: string,
    commitChanges: boolean,
  ): Promise<void> {
    try {
      if (commitChanges) {
        await this.options.sandboxBranchManager.mergeSandboxBranch(taskId);
      } else {
        await this.options.sandboxBranchManager.restoreOriginalBranch(taskId);
      }
    } finally {
      // Always release tracking block so subsequent transactions can start clean
      this.activeTasks.delete(taskId);
    }
  }
}
