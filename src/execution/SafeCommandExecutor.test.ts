import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { SafeCommandExecutor } from "./SafeCommandExecutor.js";
import { IConfigManager } from "../config/ConfigManager.js";

// Mock child_process to prevent real system command executions during testing
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

describe("SafeCommandExecutor", () => {
  const mockTemplates = {
    "test-cmd": "npm run test -- {target}",
    "lint-cmd": "eslint {target} --fix",
    "invalid-placeholder-cmd": "echo 'No placeholder here'",
  };

  let executor: SafeCommandExecutor;

  // Helper to create mock processes spawned by child_process.spawn
  function createMockChildProcess({
    stdoutData = "",
    stderrData = "",
    exitCode = 0,
    shouldFailSpawn = false,
  } = {}) {
    const processMock = new EventEmitter() as any;

    if (shouldFailSpawn) {
      processMock.stdout = null;
      processMock.stderr = null;
      process.nextTick(() => {
        processMock.emit("error", new Error("spawn ENOENT"));
      });
      return processMock;
    }

    const stdoutMock = new EventEmitter() as any;
    const originalStdoutOn = stdoutMock.on.bind(stdoutMock);
    stdoutMock.on = (event: string, fn: any) => {
      originalStdoutOn(event, fn);
      if (event === "data" && stdoutData) {
        // Emit data synchronously during registration to ensure buffer collection before close
        fn(Buffer.from(stdoutData));
      }
      return stdoutMock;
    };

    const stderrMock = new EventEmitter() as any;
    const originalStderrOn = stderrMock.on.bind(stderrMock);
    stderrMock.on = (event: string, fn: any) => {
      originalStderrOn(event, fn);
      if (event === "data" && stderrData) {
        fn(Buffer.from(stderrData));
      }
      return stderrMock;
    };

    processMock.stdout = stdoutMock;
    processMock.stderr = stderrMock;

    process.nextTick(() => {
      processMock.emit("close", exitCode);
    });

    return processMock;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new SafeCommandExecutor(mockTemplates);
  });

  describe("execute - Successful Runs (Original Signature)", () => {
    it("should successfully parameterize and execute a command key", async () => {
      const mockStdout = Buffer.from("Tests passed: 42 succeeded");
      vi.mocked(execSync).mockReturnValue(mockStdout);

      const result = await executor.execute(
        "test-cmd",
        "src/config/ConfigManager.ts",
      );

      expect(execSync).toHaveBeenCalledWith(
        "npm run test -- src/config/ConfigManager.ts",
        expect.any(Object),
      );
      expect(result).toBe("Tests passed: 42 succeeded");
    });

    it("should properly execute using the executeCommand payload object", async () => {
      const mockStdout = Buffer.from("Linting successful");
      vi.mocked(execSync).mockReturnValue(mockStdout);

      const result = await executor.executeCommand({
        commandKey: "lint-cmd",
        argumentTarget: "src/execution/SafeCommandExecutor.ts",
      });

      expect(execSync).toHaveBeenCalledWith(
        "eslint src/execution/SafeCommandExecutor.ts --fix",
        expect.any(Object),
      );
      expect(result).toBe("Linting successful");
    });
  });

  describe("execute - Validation & Parameter Integrity (Original Signature)", () => {
    it("should reject commands with an unregistered commandKey", async () => {
      await expect(
        executor.execute("unregistered-cmd", "src/file.ts"),
      ).rejects.toThrow(/Command key 'unregistered-cmd' is not registered/);

      expect(execSync).not.toHaveBeenCalled();
    });

    it("should reject execution if the template does not contain the target placeholder", async () => {
      await expect(
        executor.execute("invalid-placeholder-cmd", "src/file.ts"),
      ).rejects.toThrow(
        /Template for 'invalid-placeholder-cmd' is missing the '{target}' placeholder/,
      );

      expect(execSync).not.toHaveBeenCalled();
    });

    it("should block command injection attempts via SafeCommandValidator", async () => {
      const injectionTarget = "src/file.ts; rm -rf /";

      await expect(
        executor.execute("test-cmd", injectionTarget),
      ).rejects.toThrow(
        /Invalid parameter path: shell metacharacter injection detected/,
      );

      expect(execSync).not.toHaveBeenCalled();
    });

    it("should block directory traversal paths via SafeCommandValidator", async () => {
      const traversalTarget = "src/../../etc/passwd";

      await expect(
        executor.execute("test-cmd", traversalTarget),
      ).rejects.toThrow(
        /Invalid parameter path: directory traversal attempt detected/,
      );

      expect(execSync).not.toHaveBeenCalled();
    });
  });

  describe("execute - Failure Handling & XML-Error Formatting (Original Signature)", () => {
    it("should catch execution failure and wrap combined stderr and stdout in XML tags", async () => {
      const execError = new Error("Command failed: npm run test");
      (execError as any).status = 1;
      (execError as any).stdout = Buffer.from("Failed test case 1");
      (execError as any).stderr = Buffer.from("FATAL: syntax error");

      vi.mocked(execSync).mockImplementation(() => {
        throw execError;
      });

      await expect(
        executor.execute("test-cmd", "src/config/ConfigManager.ts"),
      ).rejects.toThrow(
        /<compiler_error>\nFATAL: syntax error\nFailed test case 1\n<\/compiler_error>/,
      );
    });

    it("should gracefully handle execution failures when only stderr is populated", async () => {
      const execError = new Error("Command failed");
      (execError as any).status = 127;
      (execError as any).stderr = Buffer.from("bash: command not found");

      vi.mocked(execSync).mockImplementation(() => {
        throw execError;
      });

      await expect(
        executor.execute("test-cmd", "src/config/ConfigManager.ts"),
      ).rejects.toThrow(
        /<compiler_error>\nbash: command not found\n<\/compiler_error>/,
      );
    });

    it("should fallback to the standard error message if both stdout and stderr are empty", async () => {
      const execError = new Error("Command terminated unexpectedly");
      (execError as any).status = -1;

      vi.mocked(execSync).mockImplementation(() => {
        throw execError;
      });

      await expect(
        executor.execute("test-cmd", "src/config/ConfigManager.ts"),
      ).rejects.toThrow(
        /<compiler_error>\nCommand terminated unexpectedly\n<\/compiler_error>/,
      );
    });
  });

  describe("executeCommand - Shell-less Process Spawning (New Signature) [REQ-03]", () => {
    it("should substitute variables index-by-index and spawn with shell: false", async () => {
      const mockChild = createMockChildProcess({
        stdoutData: "All tests passed successfully\n",
        stderrData: "",
        exitCode: 0,
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      // We inject an on-the-fly mocked ConfigManager returning a string array template
      const mockConfigManager = {
        getCommandTemplate: vi
          .fn()
          .mockResolvedValue(["npm", "run", "test", "--", "{target}"]),
        initializeConfig: vi.fn(),
        getConfigDirectoryPath: vi.fn(),
      } as unknown as IConfigManager;

      const testExecutor = new SafeCommandExecutor({}, mockConfigManager);

      const result = await testExecutor.executeCommand("test-template", {
        target: "src/math.ts",
      });

      // Assertions on child_process.spawn arguments
      expect(spawn).toHaveBeenCalledWith(
        "npm",
        ["run", "test", "--", "src/math.ts"],
        { shell: false },
      );

      // Assertions on the resolved result matching PRD simple interface contract
      expect(result).toEqual({
        stdout: "All tests passed successfully\n",
        stderr: "",
        exitCode: 0,
      });
    });

    it("should neutralize injection attempts as verified in REQ-03", async () => {
      const mockChild = createMockChildProcess({
        stdoutData: "",
        stderrData: "No such file: ; rm -rf /; \n",
        exitCode: 1,
      });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const mockConfigManager = {
        getCommandTemplate: vi
          .fn()
          .mockResolvedValue(["npm", "run", "test", "--", "{target}"]),
      } as unknown as IConfigManager;

      const testExecutor = new SafeCommandExecutor({}, mockConfigManager);

      const result = await testExecutor.executeCommand("test-template", {
        target: "; rm -rf /; ",
      });

      // Neutralized: the full injection is cleanly passed as a single element of args
      expect(spawn).toHaveBeenCalledWith(
        "npm",
        ["run", "test", "--", "; rm -rf /; "],
        { shell: false },
      );

      expect(result).toEqual({
        stdout: "",
        stderr: "No such file: ; rm -rf /; \n",
        exitCode: 1,
      });
    });

    it("should substitute multiple variables and partial templates correctly", async () => {
      const mockChild = createMockChildProcess({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const mockConfigManager = {
        getCommandTemplate: vi
          .fn()
          .mockResolvedValue([
            "git",
            "commit",
            "-m",
            "Task: {task_id}",
            "--author",
            "{author}",
          ]),
      } as unknown as IConfigManager;

      const testExecutor = new SafeCommandExecutor({}, mockConfigManager);

      await testExecutor.executeCommand("git-cmd", {
        task_id: "T123",
        author: "Agent <agent@nexus.ai>",
      });

      expect(spawn).toHaveBeenCalledWith(
        "git",
        ["commit", "-m", "Task: T123", "--author", "Agent <agent@nexus.ai>"],
        { shell: false },
      );
    });

    it("should throw an error when ConfigManager is missing and key is not in constructor templates", async () => {
      const testExecutor = new SafeCommandExecutor({});
      await expect(
        testExecutor.executeCommand("some-key", { val: "abc" }),
      ).rejects.toThrow(/Command template 'some-key' was not found/);
    });

    it("should fallback to converting constructor templates if no ConfigManager is supplied", async () => {
      const mockChild = createMockChildProcess({ exitCode: 0 });
      vi.mocked(spawn).mockReturnValue(mockChild);

      // Using the initial mockTemplates constructor argument
      const result = await executor.executeCommand("lint-cmd", {
        target: "src/test.ts",
      });

      expect(spawn).toHaveBeenCalledWith("eslint", ["src/test.ts", "--fix"], {
        shell: false,
      });

      expect(result).toEqual({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });
    });

    it("should reject with spawn execution errors (e.g. command not found)", async () => {
      const mockChild = createMockChildProcess({ shouldFailSpawn: true });
      vi.mocked(spawn).mockReturnValue(mockChild);

      const mockConfigManager = {
        getCommandTemplate: vi.fn().mockResolvedValue(["nonexistent-command"]),
      } as unknown as IConfigManager;

      const testExecutor = new SafeCommandExecutor({}, mockConfigManager);

      await expect(
        testExecutor.executeCommand("invalid-executable", {}),
      ).rejects.toThrow("spawn ENOENT");
    });
  });
});
