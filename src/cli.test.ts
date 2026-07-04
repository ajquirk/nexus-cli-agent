import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// 1. Declare and initialize the mocks inside a vi.hoisted block so they are evaluated first
const { mockStart, mockStateMachine } = vi.hoisted(() => {
  const startFn = vi.fn().mockResolvedValue(undefined);
  const stateMachineFn = vi.fn().mockImplementation(function () {
    return {
      start: startFn,
    };
  });
  return { mockStart: startFn, mockStateMachine: stateMachineFn };
});

// 2. Reference the hoisted mock implementation safely
vi.mock("./core/AgenticLoopStateMachine.js", () => {
  return {
    AgenticLoopStateMachine: mockStateMachine,
  };
});

// 3. Perform other imports after mocking
import { runCLI } from "./cli.js";
import { ConfigManager } from "./config/ConfigManager.js";
import { AgenticLoopStateMachine } from "./core/AgenticLoopStateMachine.js";

describe("Nexus CLI Runtime Hook Commands", () => {
  let tempHomeDir: string;
  let tempWorkspaceDir: string;

  beforeEach(() => {
    tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-test-home-"));
    tempWorkspaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nexus-test-workspace-"),
    );
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
    fs.rmSync(tempWorkspaceDir, { recursive: true, force: true });
  });

  describe("nexus init", () => {
    it("should generate standard configuration files in target paths", async () => {
      const argv = ["node", "nexus", "init"];

      await runCLI(argv, {
        homeDir: tempHomeDir,
        workspaceDir: tempWorkspaceDir,
      });

      const expectedEnvPath = path.join(
        tempHomeDir,
        ".config",
        "nexus",
        ".env",
      );
      const expectedWorkspaceConfigPath = path.join(
        tempWorkspaceDir,
        "agent.config.json",
      );

      expect(fs.existsSync(expectedEnvPath)).toBe(true);
      expect(fs.existsSync(expectedWorkspaceConfigPath)).toBe(true);

      const workspaceConfigContent = JSON.parse(
        fs.readFileSync(expectedWorkspaceConfigPath, "utf-8"),
      );
      expect(workspaceConfigContent.limits.stepLimit).toBe(30);
    });
  });

  describe("nexus run", () => {
    it("should start the AgenticLoopStateMachine when passed a prompt", async () => {
      const argv = ["node", "nexus", "run", "Fix bug in calculation.ts"];

      const mockStorage = {};
      const mockOrchestrator = {};
      const mockExecutor = {};
      const mockTerminal = {
        showSpinner: vi.fn(),
        stopSpinner: vi.fn(),
        displayTerminalError: vi.fn(),
      };

      await runCLI(argv, {
        homeDir: tempHomeDir,
        workspaceDir: tempWorkspaceDir,
        storageManager: mockStorage,
        orchestrator: mockOrchestrator,
        sandboxExecutor: mockExecutor,
        terminalInterface: mockTerminal,
      });

      expect(AgenticLoopStateMachine).toHaveBeenCalledWith(
        expect.objectContaining({
          storageManager: mockStorage,
          orchestrator: mockOrchestrator,
          sandboxExecutor: mockExecutor,
          terminalInterface: mockTerminal,
        }),
      );

      const mockInstance = vi.mocked(AgenticLoopStateMachine).mock.results[0]
        .value;
      expect(mockInstance.start).toHaveBeenCalledWith(
        "Fix bug in calculation.ts",
      );
    });

    it("should throw or fail if run is executed without a prompt", async () => {
      const argv = ["node", "nexus", "run"];

      await expect(
        runCLI(argv, {
          homeDir: tempHomeDir,
          workspaceDir: tempWorkspaceDir,
        }),
      ).rejects.toThrow(/Missing prompt/i);
    });
  });

  describe("CLI Validation Edge Cases", () => {
    it("should throw an error for unsupported commands", async () => {
      const argv = ["node", "nexus", "invalid-command"];

      await expect(
        runCLI(argv, {
          homeDir: tempHomeDir,
          workspaceDir: tempWorkspaceDir,
        }),
      ).rejects.toThrow(/unsupported command/i);
    });

    it("should fallback to process.argv if no arguments are provided", async () => {
      const originalArgv = process.argv;
      process.argv = ["node", "nexus", "invalid-command-fallback"];

      await expect(
        runCLI(undefined, {
          homeDir: tempHomeDir,
          workspaceDir: tempWorkspaceDir,
        }),
      ).rejects.toThrow(/unsupported command/i);

      process.argv = originalArgv;
    });
  });
});
