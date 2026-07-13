import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  WorkspaceSandboxExecutor,
  SearchReplacePatch,
} from "./WorkspaceSandboxExecutor.js";
import { SandboxBranchManager } from "../git/SandboxBranchManager.js";
import { PatchExecutor } from "../patch/PatchExecutor.js";
import { SafeCommandExecutor } from "./SafeCommandExecutor.js";

describe("WorkspaceSandboxExecutor", () => {
  let sandboxBranchManager: SandboxBranchManager;
  let patchExecutor: PatchExecutor;
  let safeCommandExecutor: SafeCommandExecutor;
  let executor: WorkspaceSandboxExecutor;

  beforeEach(() => {
    // Create isolated mocks for dependencies
    sandboxBranchManager = {
      applySandboxBranch: vi.fn().mockResolvedValue(undefined),
      restoreOriginalBranch: vi.fn().mockResolvedValue(undefined),
      mergeSandboxBranch: vi.fn().mockResolvedValue(undefined),
    } as unknown as SandboxBranchManager;

    patchExecutor = {
      applyPatch: vi.fn().mockResolvedValue(undefined),
    } as unknown as PatchExecutor;

    safeCommandExecutor = {
      executeCommand: vi.fn().mockResolvedValue({
        stdout: "tests passed",
        stderr: "",
        exitCode: 0,
      }),
    } as unknown as SafeCommandExecutor;

    executor = new WorkspaceSandboxExecutor({
      sandboxBranchManager,
      patchExecutor,
      safeCommandExecutor,
    });
  });

  describe("initializeWorkspace", () => {
    it("should successfully apply sandbox branch for a given taskId", async () => {
      await executor.initializeWorkspace("task-beta");

      expect(sandboxBranchManager.applySandboxBranch).toHaveBeenCalledWith(
        "task-beta",
      );
      expect(sandboxBranchManager.applySandboxBranch).toHaveBeenCalledTimes(1);
    });

    it("should prevent duplicate active transactions for the same taskId", async () => {
      await executor.initializeWorkspace("task-beta");

      // Attempting to initialize the same taskId again should throw
      await expect(executor.initializeWorkspace("task-beta")).rejects.toThrow(
        /Transaction already active for task: task-beta/,
      );
    });

    it("should initiate rollback and rethrow error if applySandboxBranch fails", async () => {
      const initError = new Error("Git branch checkout failed");
      vi.mocked(sandboxBranchManager.applySandboxBranch).mockRejectedValueOnce(
        initError,
      );

      await expect(executor.initializeWorkspace("task-beta")).rejects.toThrow(
        "Git branch checkout failed",
      );

      // Verify rollback step (restoreOriginalBranch) was called to clean up state
      expect(sandboxBranchManager.restoreOriginalBranch).toHaveBeenCalledWith(
        "task-beta",
      );
      expect(sandboxBranchManager.restoreOriginalBranch).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  describe("finalizeWorkspace", () => {
    it("should commit modifications by merging the branch when commitChanges is true", async () => {
      await executor.initializeWorkspace("task-beta");
      await executor.finalizeWorkspace("task-beta", true);

      expect(sandboxBranchManager.mergeSandboxBranch).toHaveBeenCalledWith(
        "task-beta",
      );
      expect(sandboxBranchManager.restoreOriginalBranch).not.toHaveBeenCalled();
    });

    it("should rollback modifications by restoring original branch when commitChanges is false", async () => {
      await executor.initializeWorkspace("task-beta");
      await executor.finalizeWorkspace("task-beta", false);

      expect(sandboxBranchManager.restoreOriginalBranch).toHaveBeenCalledWith(
        "task-beta",
      );
      expect(sandboxBranchManager.mergeSandboxBranch).not.toHaveBeenCalled();
    });

    it("should release transaction tracking on finalization, allowing re-initialization", async () => {
      await executor.initializeWorkspace("task-beta");
      await executor.finalizeWorkspace("task-beta", true);

      // Should succeed now without duplicate transaction error
      await expect(
        executor.initializeWorkspace("task-beta"),
      ).resolves.toBeUndefined();
    });
  });

  describe("executeModification & executeVerification (Standard Operations)", () => {
    it("should delegate execution of file modifications directly to PatchExecutor if initialized", async () => {
      const dummyPatch: SearchReplacePatch = {
        filePath: "src/test.ts",
        find: "const x = 1;",
        replace: "const x = 2;",
      };

      await executor.initializeWorkspace("task-beta");
      await executor.executeModification("task-beta", dummyPatch);

      expect(patchExecutor.applyPatch).toHaveBeenCalledWith(dummyPatch);
      expect(patchExecutor.applyPatch).toHaveBeenCalledTimes(1);
    });

    it("should delegate execution of safe command verifications directly to SafeCommandExecutor if initialized", async () => {
      const variables = { target: "src/test.ts" };
      await executor.initializeWorkspace("task-beta");
      const result = await executor.executeVerification(
        "task-beta",
        "npm-test",
        variables,
      );

      expect(safeCommandExecutor.executeCommand).toHaveBeenCalledWith(
        "npm-test",
        variables,
      );
      expect(safeCommandExecutor.executeCommand).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        stdout: "tests passed",
        stderr: "",
        exitCode: 0,
      });
    });
  });

  describe("executeModification & executeVerification (Transactional Guardrails)", () => {
    const dummyPatch: SearchReplacePatch = {
      filePath: "src/test.ts",
      find: "const x = 1;",
      replace: "const x = 2;",
    };

    it("should prevent execution of modifications if the workspace is not initialized", async () => {
      await expect(
        executor.executeModification("task-beta", dummyPatch),
      ).rejects.toThrow(/Transaction not active for task: task-beta/);

      expect(patchExecutor.applyPatch).not.toHaveBeenCalled();
    });

    it("should prevent execution of verifications if the workspace is not initialized", async () => {
      await expect(
        executor.executeVerification("task-beta", "npm-test", {}),
      ).rejects.toThrow(/Transaction not active for task: task-beta/);

      expect(safeCommandExecutor.executeCommand).not.toHaveBeenCalled();
    });

    it("should trigger immediate rollback and rethrow if PatchExecutor throws an error", async () => {
      vi.mocked(patchExecutor.applyPatch).mockRejectedValueOnce(
        new Error("Patch failed to apply"),
      );

      await executor.initializeWorkspace("task-beta");

      await expect(
        executor.executeModification("task-beta", dummyPatch),
      ).rejects.toThrow("Patch failed to apply");

      // Rollback should be invoked
      expect(sandboxBranchManager.restoreOriginalBranch).toHaveBeenCalledWith(
        "task-beta",
      );
      expect(sandboxBranchManager.restoreOriginalBranch).toHaveBeenCalledTimes(
        1,
      );

      // Task must be removed from active tracking on rollback
      await expect(
        executor.initializeWorkspace("task-beta"),
      ).resolves.toBeUndefined();
    });

    it("should trigger immediate rollback and throw error if verification returns a non-zero exit code", async () => {
      vi.mocked(safeCommandExecutor.executeCommand).mockResolvedValueOnce({
        stdout: "",
        stderr: "Compile Error: Undefined variable",
        exitCode: 1,
      });

      await executor.initializeWorkspace("task-beta");

      await expect(
        executor.executeVerification("task-beta", "npm-test", {}),
      ).rejects.toThrow(/Verification command failed with exit code 1/);

      // Rollback should be invoked
      expect(sandboxBranchManager.restoreOriginalBranch).toHaveBeenCalledWith(
        "task-beta",
      );
      expect(sandboxBranchManager.restoreOriginalBranch).toHaveBeenCalledTimes(
        1,
      );

      // Task must be removed from active tracking on rollback
      await expect(
        executor.initializeWorkspace("task-beta"),
      ).resolves.toBeUndefined();
    });

    it("should trigger immediate rollback and rethrow if SafeCommandExecutor rejects", async () => {
      vi.mocked(safeCommandExecutor.executeCommand).mockRejectedValueOnce(
        new Error("Process spawn failure"),
      );

      await executor.initializeWorkspace("task-beta");

      await expect(
        executor.executeVerification("task-beta", "npm-test", {}),
      ).rejects.toThrow("Process spawn failure");

      // Rollback should be invoked
      expect(sandboxBranchManager.restoreOriginalBranch).toHaveBeenCalledWith(
        "task-beta",
      );
      expect(sandboxBranchManager.restoreOriginalBranch).toHaveBeenCalledTimes(
        1,
      );

      // Task must be removed from active tracking on rollback
      await expect(
        executor.initializeWorkspace("task-beta"),
      ).resolves.toBeUndefined();
    });
  });
});
