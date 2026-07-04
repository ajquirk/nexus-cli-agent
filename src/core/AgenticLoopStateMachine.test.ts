// src/core/AgenticLoopStateMachine.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AgenticLoopStateMachine,
  SandboxExecutor,
} from "./AgenticLoopStateMachine.js";
import {
  SQLiteStorageManager,
  StepRecord,
} from "../storage/SQLiteStorageManager.js";
import {
  LLMOrchestrator,
  ToolSpec,
  AgenticDecision,
} from "../llm/LLMOrchestrator.js";
import { TerminalInterface } from "../terminal/TerminalInterface.js";

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

  it("should complete a multi-step execution loop, executing a patch and merging the branch", async () => {
    // Setup two-turn execution
    // Turn 1: tool call (apply_patch)
    // Turn 2: completion message
    vi.mocked(mockOrchestrator.generateNextTurn)
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

    // Database is initialized
    expect(mockStorageManager.initializeDatabase).toHaveBeenCalled();

    // Sandbox branch created
    expect(mockSandboxExecutor.applySandboxBranch).toHaveBeenCalled();

    // Step 1: LLM turn generated
    expect(mockOrchestrator.generateNextTurn).toHaveBeenCalledTimes(2);

    // Sandbox code patch was applied
    expect(mockSandboxExecutor.applyCodePatch).toHaveBeenCalledWith(
      "src/auth.ts",
      {
        filePath: "src/auth.ts",
        find: "function oldAuth() {}",
        replace: "function secureAuth() {}",
      },
    );

    // Step state tracked to SQLite log registries
    expect(mockStorageManager.saveStep).toHaveBeenCalledTimes(2);

    // Merged changes on success and didn't restore
    expect(mockSandboxExecutor.mergeSandboxBranch).toHaveBeenCalled();
    expect(mockSandboxExecutor.restoreOriginalBranch).not.toHaveBeenCalled();
  });

  it("should enforce the step limit, reverting any workspace changes and throwing an error", async () => {
    // Set step limit to 1, but model wants to call tool on turn 1, and complete on turn 2
    vi.mocked(mockOrchestrator.generateNextTurn)
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
      stepLimit: 1, // Strict step limit
    });

    // We expect start to throw/reject because of the step limit breach
    await expect(stateMachine.start("Run local tests")).rejects.toThrow(
      "Step Limit limit of 1 reached. Terminating loop to prevent runaway behavior",
    );

    // The single execution step is run and saved, but second step triggers boundary failure
    expect(mockStorageManager.saveStep).toHaveBeenCalledTimes(1);

    // Reverted workspace modifications
    expect(mockSandboxExecutor.restoreOriginalBranch).toHaveBeenCalled();
    expect(mockSandboxExecutor.mergeSandboxBranch).not.toHaveBeenCalled();
  });

  it("should abort and restore the original branch when the model signals a loop failure", async () => {
    vi.mocked(mockOrchestrator.generateNextTurn).mockResolvedValueOnce({
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
    vi.mocked(mockOrchestrator.generateNextTurn).mockResolvedValueOnce({
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

    // Code patch throws a filesystem exception
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

    // Changes stashed/cleaned up
    expect(mockSandboxExecutor.restoreOriginalBranch).toHaveBeenCalled();
    expect(mockSandboxExecutor.mergeSandboxBranch).not.toHaveBeenCalled();
  });

  it("should stop execution at exactly step 3 and throw runaway error when stepLimit is 3", async () => {
    // Set up a mocked LLM driver designed to continuously issue operations
    vi.mocked(mockOrchestrator.generateNextTurn).mockResolvedValue({
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

    // Confirm that orchestrator generated exactly 3 turns
    expect(mockOrchestrator.generateNextTurn).toHaveBeenCalledTimes(3);

    // Assert that 3 tool records were logged into SQLite storage
    expect(mockStorageManager.saveStep).toHaveBeenCalledTimes(3);

    // Verify workspace was cleaned up on runaway error
    expect(mockSandboxExecutor.restoreOriginalBranch).toHaveBeenCalled();
    expect(mockSandboxExecutor.mergeSandboxBranch).not.toHaveBeenCalled();
  });

  // --- TASK-18 Interrupt Handling & Cleanup Tests ---
  describe("Process Interrupt Handling & Cleanup (TASK-18)", () => {
    let initialListenerCount: number;

    beforeEach(() => {
      initialListenerCount = process.listenerCount("SIGINT");
    });

    afterEach(() => {
      // Ensure that we do not leak any registered SIGINT listeners to the test runner environment
      expect(process.listenerCount("SIGINT")).toBe(initialListenerCount);
      vi.restoreAllMocks();
    });

    it("should capture SIGINT, save interrupt log, ask user, restore branch when user declines retention, and reject", async () => {
      // Mock user selection to return false (discard sandbox branch modifications)
      vi.mocked(mockTerminalInterface.requestUserApproval).mockResolvedValue(
        false,
      );

      let triggerSigint: () => void = () => {};
      const longRunningPromise = new Promise<AgenticDecision>((resolve) => {
        triggerSigint = () => {
          process.emit("SIGINT");
        };
      });

      vi.mocked(mockOrchestrator.generateNextTurn).mockReturnValue(
        longRunningPromise,
      );

      const stateMachine = new AgenticLoopStateMachine({
        storageManager: mockStorageManager,
        orchestrator: mockOrchestrator,
        sandboxExecutor: mockSandboxExecutor,
        terminalInterface: mockTerminalInterface,
      });

      const startPromise = stateMachine.start("Interrupt task demonstration");

      // Give control back to event loop so AgenticLoop registers the SIGINT listener
      await new Promise((resolve) => setTimeout(resolve, 0));
      triggerSigint();

      await expect(startPromise).rejects.toThrow(
        "Execution interrupted by user (SIGINT)",
      );

      // Assert that execution step log is saved cleanly to SQLite write-ahead log
      expect(mockStorageManager.saveStep).toHaveBeenCalled();
      const saveCalls = vi.mocked(mockStorageManager.saveStep).mock.calls;
      expect(saveCalls.length).toBeGreaterThanOrEqual(1);

      const savedRecord = saveCalls[0][2] as StepRecord;
      expect(savedRecord.toolName).toBe("sigint_interrupt");
      expect(savedRecord.stdoutSummary).toContain("SIGINT");

      // Assert that interactive terminal prompt was issued
      expect(mockTerminalInterface.requestUserApproval).toHaveBeenCalledWith(
        expect.stringContaining("Do you want to retain the sandbox branch"),
      );

      // Verify that workspace branch recovery is triggered
      expect(mockSandboxExecutor.restoreOriginalBranch).toHaveBeenCalled();
    });

    it("should capture SIGINT, save log, ask user, and NOT restore branch when user accepts retention, and reject", async () => {
      // Mock user selection to return true (retain experimental sandbox branch changes)
      vi.mocked(mockTerminalInterface.requestUserApproval).mockResolvedValue(
        true,
      );

      let triggerSigint: () => void = () => {};
      const longRunningPromise = new Promise<AgenticDecision>((resolve) => {
        triggerSigint = () => {
          process.emit("SIGINT");
        };
      });

      vi.mocked(mockOrchestrator.generateNextTurn).mockReturnValue(
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

      // Since developer elected to retain sandbox branch, skip restore cleanup
      expect(mockSandboxExecutor.restoreOriginalBranch).not.toHaveBeenCalled();
    });

    it("should cleanly remove SIGINT listener upon normal completion of the loop", async () => {
      vi.mocked(mockOrchestrator.generateNextTurn).mockResolvedValue({
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
      // Lifecycle listener cleanup is evaluated and asserted inside afterEach
    });
  });
});
