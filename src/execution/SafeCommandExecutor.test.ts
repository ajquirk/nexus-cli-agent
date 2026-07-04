import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { SafeCommandExecutor } from "./SafeCommandExecutor.js";

// Mock child_process to prevent real system command executions during testing
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("SafeCommandExecutor", () => {
  const mockTemplates = {
    "test-cmd": "npm run test -- {target}",
    "lint-cmd": "eslint {target} --fix",
    "invalid-placeholder-cmd": "echo 'No placeholder here'",
  };

  let executor: SafeCommandExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new SafeCommandExecutor(mockTemplates);
  });

  describe("execute - Successful Runs", () => {
    it("should successfully parameterize and execute a command key", async () => {
      // Mock execSync to return a Buffer containing stdout
      const mockStdout = Buffer.from("Tests passed: 42 succeeded");
      vi.mocked(execSync).mockReturnValue(mockStdout);

      const result = await executor.execute(
        "test-cmd",
        "src/config/ConfigManager.ts",
      );

      // Verify validation, templating, and execSync invocation
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

  describe("execute - Validation & Parameter Integrity", () => {
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

  describe("execute - Failure Handling & XML-Error Formatting", () => {
    it("should catch execution failure and wrap combined stderr and stdout in XML tags", async () => {
      // execSync throws an error object when the process exits with a non-zero code.
      // This error object contains stdout and stderr buffers if populated.
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
});
