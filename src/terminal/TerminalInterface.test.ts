import { describe, it, expect, beforeEach, vi } from "vitest";
import { PassThrough } from "stream";
import { ClackTerminalInterface } from "./TerminalInterface.js";

// Mock @clack/prompts to verify spinner routines
const mockSpinnerInstance = {
  start: vi.fn(),
  stop: vi.fn(),
};

vi.mock("@clack/prompts", () => {
  return {
    spinner: () => mockSpinnerInstance,
  };
});

describe("ClackTerminalInterface - Interactive Prompts and Diff Rendering", () => {
  let mockStdout: { write: (str: string) => boolean; output: string[] };
  let mockStdin: PassThrough;
  let terminal: ClackTerminalInterface;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStdout = {
      output: [],
      write(str: string) {
        this.output.push(str);
        return true;
      },
    };
    mockStdin = new PassThrough();
    terminal = new ClackTerminalInterface({
      stdout: mockStdout,
      stdin: mockStdin,
    });
  });

  describe("Spinner Orchestration", () => {
    it("should start a spinner with the given message", () => {
      terminal.showSpinner("Thinking...");

      expect(mockSpinnerInstance.start).toHaveBeenCalledWith("Thinking...");
    });

    it("should stop an active spinner with success status", () => {
      terminal.showSpinner("Thinking...");
      terminal.stopSpinner(true, "Done!");

      expect(mockSpinnerInstance.stop).toHaveBeenCalledWith("Done!", 0);
    });

    it("should stop an active spinner with failure status", () => {
      terminal.showSpinner("Thinking...");
      terminal.stopSpinner(false, "Failed!");

      expect(mockSpinnerInstance.stop).toHaveBeenCalledWith("Failed!", 1);
    });

    it("should stop any existing spinner before starting a new one", () => {
      terminal.showSpinner("First Task");
      terminal.showSpinner("Second Task");

      expect(mockSpinnerInstance.stop).toHaveBeenCalledWith("Interrupted", 1);
      expect(mockSpinnerInstance.start).toHaveBeenLastCalledWith("Second Task");
    });
  });

  describe("requestUserApproval", () => {
    it("should resolve to true when user inputs 'y'", async () => {
      const approvalPromise =
        terminal.requestUserApproval("Proceed with plan?");

      // Simulate user typing 'y' and hitting Enter
      mockStdin.write("y\n");

      const result = await approvalPromise;
      expect(result).toBe(true);
      expect(mockStdout.output.join("")).toContain("Proceed with plan?");
    });

    it("should resolve to true when user inputs 'YES' (case-insensitive)", async () => {
      const approvalPromise =
        terminal.requestUserApproval("Proceed with plan?");

      mockStdin.write("YES\n");

      const result = await approvalPromise;
      expect(result).toBe(true);
    });

    it("should resolve to false when user inputs 'n'", async () => {
      const approvalPromise =
        terminal.requestUserApproval("Proceed with plan?");

      mockStdin.write("n\n");

      const result = await approvalPromise;
      expect(result).toBe(false);
    });

    it("should resolve to false when user inputs other unexpected keys", async () => {
      const approvalPromise =
        terminal.requestUserApproval("Proceed with plan?");

      mockStdin.write("maybe\n");

      const result = await approvalPromise;
      expect(result).toBe(false);
    });
  });

  describe("renderDiffView", () => {
    it("should color added lines green, omitting file headers from basic match", () => {
      const diffText = [
        "--- a/file.txt",
        "+++ b/file.txt",
        "@@ -1,3 +1,3 @@",
        " normal line",
        "-removed line",
        "+added line",
      ].join("\n");

      terminal.renderDiffView(diffText);

      const combinedOutput = mockStdout.output.join("");

      // Check that standard added line starts with green formatting (\x1b[32m)
      expect(combinedOutput).toContain("\x1b[32m+added line");
      // Check that standard removed line starts with red formatting (\x1b[31m)
      expect(combinedOutput).toContain("\x1b[31m-removed line");
      // Check that hunk header is cyan formatting (\x1b[36m)
      expect(combinedOutput).toContain("\x1b[36m@@ -1,3 +1,3 @@");
      // Check that file headers are distinctly styled (e.g., grey)
      expect(combinedOutput).toContain("\x1b[90m--- a/file.txt");
      expect(combinedOutput).toContain("\x1b[90m+++ b/file.txt");
    });
  });

  describe("displayTerminalError", () => {
    it("should style terminal error outputs in red", () => {
      terminal.displayTerminalError("Failed to build");
      const combinedOutput = mockStdout.output.join("");
      expect(combinedOutput).toContain(
        "\x1b[31m✖ Error: Failed to build\x1b[0m\n",
      );
    });
  });
});
