// src/core/AgenticLoopStateMachine.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AgenticLoopStateMachine,
  SandboxExecutor,
  LoopCompletionStatus,
} from "./AgenticLoopStateMachine.js";
import { SQLiteStorageManager } from "../storage/SQLiteStorageManager.js";
import {
  LLMOrchestrator,
  ToolSpec,
  AgenticDecision,
  StepRecord,
  ChatMessage,
  LLMTurnResult,
} from "../llm/LLMOrchestrator.js";
import { TerminalInterface } from "../terminal/TerminalInterface.js";
import { WorkspaceSandboxExecutor } from "../execution/WorkspaceSandboxExecutor.js";

describe("AgenticLoopStateMachine", () => {
  let mockStorageManager: SQLiteStorageManager;
  let mockOrchestrator: LLMOrchestrator;
  let mockSandboxExecutor: SandboxExecutor;
  let mockTerminalInterface: TerminalInterface;

  beforeEach(() => {
    // 1. Mock SQLiteStorageManager
    const savedSteps: StepRecord[] = [];
    mockStorageManager = {
      initializeDatabase: vi.fn().mockResolvedValue(undefined),
      saveStep: vi
        .fn()
        .mockImplementation(async (sessionId, stepIndex, payload) => {
          savedSteps.push(payload);
        }),
      getSessionHistory: vi.fn().mockImplementation(async () => {
        return [...savedSteps];
      }),
      logRateLimitCooldown: vi.fn().mockResolvedValue(undefined),
      getRateLimitCooldown: vi.fn().mockResolvedValue(null),
    } as unknown as SQLiteStorageManager;

    // 2. Mock LLMOrchestrator
    mockOrchestrator = {
      generateNextTurn: vi.fn(),
      pruneContext: vi
        .fn()
        .mockImplementation(async (history: ChatMessage[]) => {
          // Mock pruning behavior: keep system prompt, first task prompt, and compress middle
          return [
            { role: "system", content: "System updated summary" },
            ...history.slice(history.length - 2),
          ];
        }),
    } as unknown as LLMOrchestrator;

    // 3. Mock SandboxExecutor
    mockSandboxExecutor = {
      applySandboxBranch: vi.fn().mockResolvedValue(undefined),
      restoreOriginalBranch: vi.fn().mockResolvedValue(undefined),
      mergeSandboxBranch: vi.fn().mockResolvedValue(undefined),
      applyCodePatch: vi.fn().mockResolvedValue(undefined),
      executeCommand: vi.fn().mockResolvedValue("Command output"),
    };

    // 4. Mock TerminalInterface
    mockTerminalInterface = {
      showSpinner: vi.fn(),
      stopSpinner: vi.fn(),
      requestUserApproval: vi.fn().mockResolvedValue(true),
      renderDiffView: vi.fn(),
      displayTerminalError: vi.fn(),
    };
  });

  // --- EXISTING TESTS (REPAIRED & CLEANLY PRESERVED) ---

  it("should complete a multi-step execution loop, executing a patch and merging the branch", async () => {
    vi.mocked(mockOrchestrator.generateNextTurn as any)
      .mockResolvedValueOnce({
        type: "tool_call",
        toolCall: {
          id: "call-001",
          name: "apply_patch",
          args: {
            filePath: "src/auth.ts",
            find: "function oldAuth() {}",
            replace: "function secureAuth() {}",
          },
        },
      })
      .mockResolvedValueOnce({
        type: "complete",
        message: "Refactoring completed successfully.",
      });

    const stateMachine = new AgenticLoopStateMachine({
      storageManager: mockStorageManager,
      orchestrator: mockOrchestrator,
      sandboxExecutor: mockSandboxExecutor,
      terminalInterface: mockTerminalInterface,
      stepLimit: 5,
    });

    await stateMachine.start("Refactor login verification system");

    expect(mockStorageManager.initializeDatabase).toHaveBeenCalled();
    expect(mockSandboxExecutor.applySandboxBranch).toHaveBeenCalled();
    expect(mockOrchestrator.generateNextTurn).toHaveBeenCalledTimes(2);
    expect(mockSandboxExecutor.applyCodePatch).toHaveBeenCalledWith(
      "src/auth.ts",
      {
        filePath: "src/auth.ts",
        find: "function oldAuth() {}",
        replace: "function secureAuth() {}",
      },
    );
    expect(mockStorageManager.saveStep).toHaveBeenCalledTimes(2);
    expect(mockSandboxExecutor.mergeSandboxBranch).toHaveBeenCalled();
    expect(mockSandboxExecutor.restoreOriginalBranch).not.toHaveBeenCalled();
  });

  it("should enforce the step limit, reverting any workspace changes and throwing an error", async () => {
    vi.mocked(mockOrchestrator.generateNextTurn as any)
      .mockResolvedValueOnce({
        type: "tool_call",
        toolCall: {
          id: "call-001",
          name: "execute_command",
          args: {
            commandKey: "test",
            argumentTarget: "--all",
          },
        },
      })
      .mockResolvedValueOnce({
        type: "complete",
        message: "Done",
      });

    const stateMachine = new AgenticLoopStateMachine({
      storageManager: mockStorageManager,
      orchestrator: mockOrchestrator,
      sandboxExecutor: mockSandboxExecutor,
      terminalInterface: mockTerminalInterface,
      stepLimit: 1,
    });

    await expect(stateMachine.start("Run local tests")).rejects.toThrow(
      "Step Limit limit of 1 reached. Terminating loop to prevent runaway behavior",
    );

    expect(mockStorageManager.saveStep).toHaveBeenCalledTimes(1);
    expect(mockSandboxExecutor.restoreOriginalBranch).toHaveBeenCalled();
    expect(mockSandboxExecutor.mergeSandboxBranch).not.toHaveBeenCalled();
  });

  it("should abort and restore the original branch when the model signals a loop failure", async () => {
    vi.mocked(mockOrchestrator.generateNextTurn as any).mockResolvedValueOnce({
      type: "fail",
      message: "Model unable to proceed with task context.",
    });

    const stateMachine = new AgenticLoopStateMachine({
      storageManager: mockStorageManager,
      orchestrator: mockOrchestrator,
      sandboxExecutor: mockSandboxExecutor,
      terminalInterface: mockTerminalInterface,
      stepLimit: 3,
    });

    await expect(stateMachine.start("Analyze complex system")).rejects.toThrow(
      "Agent execution failed: Model unable to proceed with task context.",
    );

    expect(mockSandboxExecutor.restoreOriginalBranch).toHaveBeenCalled();
    expect(mockSandboxExecutor.mergeSandboxBranch).not.toHaveBeenCalled();
  });

  it("should rollback to the original branch if a critical execution step throws", async () => {
    vi.mocked(mockOrchestrator.generateNextTurn as any).mockResolvedValueOnce({
      type: "tool_call",
      toolCall: {
        id: "call-fail",
        name: "apply_patch",
        args: {
          filePath: "src/index.ts",
          find: "old",
          replace: "new",
        },
      },
    });

    vi.mocked(mockSandboxExecutor.applyCodePatch).mockRejectedValueOnce(
      new Error("Filesystem write failure"),
    );

    const stateMachine = new AgenticLoopStateMachine({
      storageManager: mockStorageManager,
      orchestrator: mockOrchestrator,
      sandboxExecutor: mockSandboxExecutor,
      terminalInterface: mockTerminalInterface,
      stepLimit: 3,
    });

    await expect(stateMachine.start("Apply dynamic patch")).rejects.toThrow(
      "Filesystem write failure",
    );

    expect(mockSandboxExecutor.restoreOriginalBranch).toHaveBeenCalled();
    expect(mockSandboxExecutor.mergeSandboxBranch).not.toHaveBeenCalled();
  });

  it("should stop execution at exactly step 3 and throw runaway error when stepLimit is 3", async () => {
    vi.mocked(mockOrchestrator.generateNextTurn as any).mockResolvedValue({
      type: "tool_call",
      toolCall: {
        id: "call-runaway",
        name: "execute_command",
        args: {
          commandKey: "npm_test",
          argumentTarget: "src/core",
        },
      },
    });

    const stateMachine = new AgenticLoopStateMachine({
      storageManager: mockStorageManager,
      orchestrator: mockOrchestrator,
      sandboxExecutor: mockSandboxExecutor,
      terminalInterface: mockTerminalInterface,
      stepLimit: 3,
    });

    await expect(
      stateMachine.start("Audit code base patterns"),
    ).rejects.toThrowError(
      "Step Limit limit of 3 reached. Terminating loop to prevent runaway behavior",
    );

    expect(mockOrchestrator.generateNextTurn).toHaveBeenCalledTimes(3);
    expect(mockStorageManager.saveStep).toHaveBeenCalledTimes(3);
    expect(mockSandboxExecutor.restoreOriginalBranch).toHaveBeenCalled();
    expect(mockSandboxExecutor.mergeSandboxBranch).not.toHaveBeenCalled();
  });

  describe("Process Interrupt Handling & Cleanup (TASK-18)", () => {
    let initialListenerCount: number;

    beforeEach(() => {
      initialListenerCount = process.listenerCount("SIGINT");
    });

    afterEach(() => {
      expect(process.listenerCount("SIGINT")).toBe(initialListenerCount);
      vi.restoreAllMocks();
    });

    it("should capture SIGINT, save interrupt log, ask user, restore branch when user declines retention, and reject", async () => {
      vi.mocked(mockTerminalInterface.requestUserApproval).mockResolvedValue(
        false,
      );

      let triggerSigint: () => void = () => {};
      const longRunningPromise = new Promise<AgenticDecision>((resolve) => {
        triggerSigint = () => {
          process.emit("SIGINT");
        };
      });

      vi.mocked(mockOrchestrator.generateNextTurn as any).mockReturnValue(
        longRunningPromise,
      );

      const stateMachine = new AgenticLoopStateMachine({
        storageManager: mockStorageManager,
        orchestrator: mockOrchestrator,
        sandboxExecutor: mockSandboxExecutor,
        terminalInterface: mockTerminalInterface,
      });

      const startPromise = stateMachine.start("Interrupt task demonstration");

      await new Promise((resolve) => setTimeout(resolve, 0));
      triggerSigint();

      await expect(startPromise).rejects.toThrow(
        "Execution interrupted by user (SIGINT)",
      );

      expect(mockStorageManager.saveStep).toHaveBeenCalled();
      const saveCalls = vi.mocked(mockStorageManager.saveStep).mock.calls;
      expect(saveCalls.length).toBeGreaterThanOrEqual(1);

      const savedRecord = saveCalls[0][2] as StepRecord;
      expect(savedRecord.toolName).toBe("sigint_interrupt");
      expect(savedRecord.stdoutSummary).toContain("SIGINT");

      expect(mockTerminalInterface.requestUserApproval).toHaveBeenCalledWith(
        expect.stringContaining("Do you want to retain the sandbox branch"),
      );

      expect(mockSandboxExecutor.restoreOriginalBranch).toHaveBeenCalled();
    });

    it("should capture SIGINT, save log, ask user, and NOT restore branch when user accepts retention, and reject", async () => {
      vi.mocked(mockTerminalInterface.requestUserApproval).mockResolvedValue(
        true,
      );

      let triggerSigint: () => void = () => {};
      const longRunningPromise = new Promise<AgenticDecision>((resolve) => {
        triggerSigint = () => {
          process.emit("SIGINT");
        };
      });

      vi.mocked(mockOrchestrator.generateNextTurn as any).mockReturnValue(
        longRunningPromise,
      );

      const stateMachine = new AgenticLoopStateMachine({
        storageManager: mockStorageManager,
        orchestrator: mockOrchestrator,
        sandboxExecutor: mockSandboxExecutor,
        terminalInterface: mockTerminalInterface,
      });

      const startPromise = stateMachine.start(
        "Interrupt task retention demonstration",
      );

      await new Promise((resolve) => setTimeout(resolve, 0));
      triggerSigint();

      await expect(startPromise).rejects.toThrow(
        "Execution interrupted by user (SIGINT)",
      );

      expect(mockStorageManager.saveStep).toHaveBeenCalled();
      expect(mockTerminalInterface.requestUserApproval).toHaveBeenCalled();
      expect(mockSandboxExecutor.restoreOriginalBranch).not.toHaveBeenCalled();
    });

    it("should cleanly remove SIGINT listener upon normal completion of the loop", async () => {
      vi.mocked(mockOrchestrator.generateNextTurn as any).mockResolvedValue({
        type: "complete",
        message: "Execution resolved successfully.",
      });

      const stateMachine = new AgenticLoopStateMachine({
        storageManager: mockStorageManager,
        orchestrator: mockOrchestrator,
        sandboxExecutor: mockSandboxExecutor,
        terminalInterface: mockTerminalInterface,
      });

      await stateMachine.start("Normal resolve demonstration");

      expect(mockStorageManager.saveStep).toHaveBeenCalled();
      expect(
        vi.mocked(mockStorageManager.saveStep).mock.calls[0][2].toolName,
      ).toBe("complete");
      expect(mockSandboxExecutor.restoreOriginalBranch).not.toHaveBeenCalled();
    });
  });

  // --- EXISTING [TASK-11] SPECIFIC executeLoop TESTS ---

  describe("executeLoop (TASK-11 Specific)", () => {
    it("should execute a clean loop path and succeed immediately when isTerminal is true", async () => {
      vi.mocked(mockOrchestrator.generateNextTurn as any).mockResolvedValueOnce(
        {
          thought: "I have successfully verified the workspace requirements.",
          isTerminal: true,
        } as LLMTurnResult,
      );

      const stateMachine = new AgenticLoopStateMachine({
        storageManager: mockStorageManager,
        orchestrator: mockOrchestrator,
        sandboxExecutor: mockSandboxExecutor,
        terminalInterface: mockTerminalInterface,
        stepLimit: 5,
      });

      const result = await stateMachine.executeLoop(
        "task-gamma",
        "Build module",
      );

      expect(result.status).toBe("complete");
      expect(result.summary).toBe(
        "I have successfully verified the workspace requirements.",
      );
      expect(mockSandboxExecutor.applySandboxBranch).toHaveBeenCalledWith(
        "task-gamma",
      );
      expect(mockSandboxExecutor.mergeSandboxBranch).toHaveBeenCalled();
      expect(mockSandboxExecutor.restoreOriginalBranch).not.toHaveBeenCalled();
    });

    it("should process a patch suggestion, apply it successfully, and terminate successfully on next turn", async () => {
      vi.mocked(mockOrchestrator.generateNextTurn as any)
        .mockResolvedValueOnce({
          thought: "Need to update core file structure.",
          suggestedAction: {
            type: "patch",
            payload: {
              filePath: "src/core.ts",
              find: "const original = true;",
              replace: "const original = false;",
            },
          },
          isTerminal: false,
        } as LLMTurnResult)
        .mockResolvedValueOnce({
          thought: "Everything looks complete.",
          isTerminal: true,
        } as LLMTurnResult);

      const stateMachine = new AgenticLoopStateMachine({
        storageManager: mockStorageManager,
        orchestrator: mockOrchestrator,
        sandboxExecutor: mockSandboxExecutor,
        terminalInterface: mockTerminalInterface,
        stepLimit: 5,
      });

      const result = await stateMachine.executeLoop(
        "task-gamma",
        "Build module",
      );

      expect(result.status).toBe("complete");
      expect(mockSandboxExecutor.applyCodePatch).toHaveBeenCalledWith(
        "src/core.ts",
        {
          filePath: "src/core.ts",
          find: "const original = true;",
          replace: "const original = false;",
        },
      );
      expect(mockSandboxExecutor.mergeSandboxBranch).toHaveBeenCalled();
    });

    it("should process a command suggestion, execute it successfully, and terminate successfully on next turn", async () => {
      vi.mocked(mockOrchestrator.generateNextTurn as any)
        .mockResolvedValueOnce({
          thought: "Let's run local test checks.",
          suggestedAction: {
            type: "command",
            payload: {
              templateKey: "npm_test",
              variables: { target: "src/core" },
            },
          },
          isTerminal: false,
        } as LLMTurnResult)
        .mockResolvedValueOnce({
          thought: "Tests pass. Done.",
          isTerminal: true,
        } as LLMTurnResult);

      const stateMachine = new AgenticLoopStateMachine({
        storageManager: mockStorageManager,
        orchestrator: mockOrchestrator,
        sandboxExecutor: mockSandboxExecutor,
        terminalInterface: mockTerminalInterface,
        stepLimit: 5,
      });

      const result = await stateMachine.executeLoop(
        "task-gamma",
        "Build module",
      );

      expect(result.status).toBe("complete");
      expect(mockSandboxExecutor.executeCommand).toHaveBeenCalledWith({
        commandKey: "npm_test",
        argumentTarget: "src/core",
      });
      expect(mockSandboxExecutor.mergeSandboxBranch).toHaveBeenCalled();
    });

    it("should fail loop and trigger branch rollback when execution passes stepLimit thresholds", async () => {
      // Endless loop driver
      vi.mocked(mockOrchestrator.generateNextTurn as any).mockResolvedValue({
        thought: "Working...",
        suggestedAction: {
          type: "command",
          payload: { templateKey: "npm_test", variables: {} },
        },
        isTerminal: false,
      } as LLMTurnResult);

      const stateMachine = new AgenticLoopStateMachine({
        storageManager: mockStorageManager,
        orchestrator: mockOrchestrator,
        sandboxExecutor: mockSandboxExecutor,
        terminalInterface: mockTerminalInterface,
        stepLimit: 2, // Maximum 2 loops
      });

      const result = await stateMachine.executeLoop(
        "task-gamma",
        "Build module",
      );

      expect(result.status).toBe("fail");
      expect(result.summary).toContain("Loop count exhaustion");
      expect(mockSandboxExecutor.restoreOriginalBranch).toHaveBeenCalled();
      expect(mockSandboxExecutor.mergeSandboxBranch).not.toHaveBeenCalled();
    });

    it("should rollback to original branch if code patch fails during executeLoop", async () => {
      vi.mocked(mockOrchestrator.generateNextTurn as any).mockResolvedValueOnce(
        {
          thought: "Try to patch.",
          suggestedAction: {
            type: "patch",
            payload: { filePath: "broken.ts", find: "x", replace: "y" },
          },
          isTerminal: false,
        } as LLMTurnResult,
      );

      vi.mocked(mockSandboxExecutor.applyCodePatch).mockRejectedValueOnce(
        new Error("Failsystem lock issue"),
      );

      const stateMachine = new AgenticLoopStateMachine({
        storageManager: mockStorageManager,
        orchestrator: mockOrchestrator,
        sandboxExecutor: mockSandboxExecutor,
        terminalInterface: mockTerminalInterface,
      });

      const result = await stateMachine.executeLoop(
        "task-gamma",
        "Build module",
      );

      expect(result.status).toBe("fail");
      expect(result.summary).toContain("Failsystem lock issue");
      expect(mockSandboxExecutor.restoreOriginalBranch).toHaveBeenCalled();
      expect(mockSandboxExecutor.mergeSandboxBranch).not.toHaveBeenCalled();
    });

    it("should trigger context pruning when cumulative history token count exceeds 80% threshold", async () => {
      vi.mocked(mockOrchestrator.generateNextTurn as any)
        .mockResolvedValueOnce({
          thought:
            "Some highly verbose thought content which will inflate our token estimates...",
          suggestedAction: {
            type: "command",
            payload: { templateKey: "npm_test", variables: {} },
          },
          isTerminal: false,
        } as LLMTurnResult)
        .mockResolvedValueOnce({
          thought: "Everything verified successfully.",
          isTerminal: true,
        } as LLMTurnResult);

      const stateMachine = new AgenticLoopStateMachine({
        storageManager: mockStorageManager,
        orchestrator: mockOrchestrator,
        sandboxExecutor: mockSandboxExecutor,
        terminalInterface: mockTerminalInterface,
        stepLimit: 5,
        maxContextTokens: 20, // Forces pruning at very low thresholds
      });

      const result = await stateMachine.executeLoop(
        "task-gamma",
        "Build module",
      );

      expect(result.status).toBe("complete");
      expect(mockOrchestrator.pruneContext).toHaveBeenCalled();
    });

    it("should trigger context pruning when iterative cycles exceed 15", async () => {
      let mockCycles = 0;
      // Mock generateNextTurn returning a non-terminal action, tracked by a cycle counter
      vi.mocked(mockOrchestrator.generateNextTurn as any).mockImplementation(
        async (_prompt: string, history: ChatMessage[]) => {
          mockCycles++;
          if (mockCycles >= 16) {
            return {
              thought: "Completed after many turns.",
              isTerminal: true,
            } as LLMTurnResult;
          }
          return {
            thought: "Iteration cycle...",
            suggestedAction: {
              type: "command",
              payload: { templateKey: "npm_test", variables: {} },
            },
            isTerminal: false,
          } as LLMTurnResult;
        },
      );

      const stateMachine = new AgenticLoopStateMachine({
        storageManager: mockStorageManager,
        orchestrator: mockOrchestrator,
        sandboxExecutor: mockSandboxExecutor,
        terminalInterface: mockTerminalInterface,
        stepLimit: 20, // Let it run past 15 to trigger turn pruning
        maxContextTokens: 10000, // Prevent token pruning
      });

      const result = await stateMachine.executeLoop(
        "task-gamma",
        "Build module",
      );

      expect(result.status).toBe("complete");
      expect(mockOrchestrator.pruneContext).toHaveBeenCalled();
    });
  });

  // --- NEW [TASK-12] SPECIFIC executeLoop TESTS WITH WorkspaceSandboxExecutor ---

  describe("executeLoop with WorkspaceSandboxExecutor (TASK-12 Specific)", () => {
    let mockWorkspaceExecutor: WorkspaceSandboxExecutor;
    let initialListenerCount: number;

    beforeEach(() => {
      mockWorkspaceExecutor = {
        initializeWorkspace: vi.fn().mockResolvedValue(undefined),
        executeModification: vi.fn().mockResolvedValue(undefined),
        executeVerification: vi
          .fn()
          .mockResolvedValue({
            stdout: "Verification passed",
            stderr: "",
            exitCode: 0,
          }),
        finalizeWorkspace: vi.fn().mockResolvedValue(undefined),
      } as unknown as WorkspaceSandboxExecutor;
      initialListenerCount = process.listenerCount("SIGINT");
    });

    afterEach(() => {
      expect(process.listenerCount("SIGINT")).toBe(initialListenerCount);
    });

    it("should successfully execute modification and verification, commit changes, and complete", async () => {
      vi.mocked(mockOrchestrator.generateNextTurn as any)
        .mockResolvedValueOnce({
          thought: "Applying search replace patch to fix the email constraint.",
          suggestedAction: {
            type: "patch",
            payload: {
              filePath: "src/models/User.ts",
              find: "email: string",
              replace: "email: string; // unique",
            },
          },
          isTerminal: false,
        } as LLMTurnResult)
        .mockResolvedValueOnce({
          thought: "Running tests to verify uniqueness.",
          suggestedAction: {
            type: "command",
            payload: {
              templateKey: "npm_test",
              variables: { target: "src/models/User.ts" },
            },
          },
          isTerminal: false,
        } as LLMTurnResult)
        .mockResolvedValueOnce({
          thought: "Tests passed. Complete.",
          isTerminal: true,
        } as LLMTurnResult);

      const stateMachine = new AgenticLoopStateMachine({
        storageManager: mockStorageManager,
        orchestrator: mockOrchestrator,
        workspaceSandboxExecutor: mockWorkspaceExecutor,
        terminalInterface: mockTerminalInterface,
        stepLimit: 5,
      });

      const result = await stateMachine.executeLoop(
        "task-123",
        "Implement unique constraint on email",
      );

      expect(result.status).toBe("complete");
      expect(result.summary).toContain("Complete");

      expect(mockWorkspaceExecutor.initializeWorkspace).toHaveBeenCalledWith(
        "task-123",
      );
      expect(mockWorkspaceExecutor.executeModification).toHaveBeenCalledWith(
        "task-123",
        {
          filePath: "src/models/User.ts",
          find: "email: string",
          replace: "email: string; // unique",
        },
      );
      expect(mockWorkspaceExecutor.executeVerification).toHaveBeenCalledWith(
        "task-123",
        "npm_test",
        { target: "src/models/User.ts" },
      );
      expect(mockWorkspaceExecutor.finalizeWorkspace).toHaveBeenCalledWith(
        "task-123",
        true,
      );
    });

    it("should rollback workspace and fail when a modification throws an error", async () => {
      vi.mocked(mockOrchestrator.generateNextTurn as any).mockResolvedValueOnce(
        {
          thought: "Applying invalid patch.",
          suggestedAction: {
            type: "patch",
            payload: {
              filePath: "src/models/User.ts",
              find: "email",
              replace: "invalid",
            },
          },
          isTerminal: false,
        } as LLMTurnResult,
      );

      vi.mocked(
        mockWorkspaceExecutor.executeModification,
      ).mockRejectedValueOnce(
        new Error("AmbiguousPatchError: multiple matches found"),
      );

      const stateMachine = new AgenticLoopStateMachine({
        storageManager: mockStorageManager,
        orchestrator: mockOrchestrator,
        workspaceSandboxExecutor: mockWorkspaceExecutor,
        terminalInterface: mockTerminalInterface,
      });

      const result = await stateMachine.executeLoop(
        "task-123",
        "Implement unique constraint on email",
      );

      expect(result.status).toBe("fail");
      expect(result.summary).toContain("AmbiguousPatchError");
      expect(mockWorkspaceExecutor.finalizeWorkspace).toHaveBeenCalledWith(
        "task-123",
        false,
      );
    });

    it("should handle SIGINT during executeLoop, restore workspace, and reject with SIGINT error", async () => {
      vi.mocked(mockTerminalInterface.requestUserApproval).mockResolvedValue(
        false,
      );

      let triggerSigint: () => void = () => {};
      const longRunningPromise = new Promise<LLMTurnResult>(() => {
        triggerSigint = () => {
          process.emit("SIGINT");
        };
      });

      vi.mocked(mockOrchestrator.generateNextTurn as any).mockReturnValue(
        longRunningPromise,
      );

      const stateMachine = new AgenticLoopStateMachine({
        storageManager: mockStorageManager,
        orchestrator: mockOrchestrator,
        workspaceSandboxExecutor: mockWorkspaceExecutor,
        terminalInterface: mockTerminalInterface,
      });

      const executePromise = stateMachine.executeLoop(
        "task-sigint",
        "Long running task",
      );

      // Give event loop a tick to register signal handler
      await new Promise((resolve) => setTimeout(resolve, 0));
      triggerSigint();

      await expect(executePromise).rejects.toThrow(
        "Execution interrupted by user (SIGINT)",
      );
      expect(mockWorkspaceExecutor.finalizeWorkspace).toHaveBeenCalledWith(
        "task-sigint",
        false,
      );
    });
  });
});
