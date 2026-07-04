import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { ClackTerminalInterface } from "./TerminalInterface.js";

// Setup state to share the current test's injected writer with the clack/prompts mock
let currentTestWriter: { write(str: string): boolean } | null = null;

// Mock @clack/prompts to simulate terminal rendering deterministically
vi.mock("@clack/prompts", () => {
  return {
    spinner: () => {
      return {
        start: (msg: string) => {
          const formatted = `\x1b[?25l◒  ${msg}\n`;
          if (currentTestWriter) {
            currentTestWriter.write(formatted);
          } else {
            process.stdout.write(formatted);
          }
        },
        stop: (msg: string, code?: number) => {
          const prefix = code === 0 ? "✔" : "✖";
          const formatted = `\x1b[?25h${prefix}  ${msg}\n`;
          if (currentTestWriter) {
            currentTestWriter.write(formatted);
          } else {
            process.stdout.write(formatted);
          }
        },
      };
    },
  };
});

describe("ClackTerminalInterface", () => {
  let capturedOutput: string[];
  let mockWriter: { write(str: string): boolean };
  let terminal: ClackTerminalInterface;

  beforeEach(() => {
    capturedOutput = [];
    mockWriter = {
      write: (str: string) => {
        capturedOutput.push(str);
        return true;
      },
    };
    currentTestWriter = mockWriter;
    terminal = new ClackTerminalInterface({ stdout: mockWriter });
  });

  afterEach(() => {
    currentTestWriter = null;
    vi.restoreAllMocks();
  });

  describe("Loading Spinner (showSpinner / stopSpinner)", () => {
    it("should write start spinner ANSI sequences and text instructions to standard output", () => {
      terminal.showSpinner("Saving Workspace Status...");

      const output = capturedOutput.join("");
      // Assert that the ANSI hide cursor sequence \x1b[?25l and text are present
      expect(output).toContain("\x1b[?25l");
      expect(output).toContain("Saving Workspace Status...");
    });

    it("should write stop spinner success ANSI sequence and message to standard output", () => {
      terminal.showSpinner("Saving Workspace Status...");
      terminal.stopSpinner(true, "Workspace Saved Successfully");

      const output = capturedOutput.join("");
      // Assert that ANSI show cursor \x1b[?25h and success symbol are outputted
      expect(output).toContain("\x1b[?25h");
      expect(output).toContain("✔");
      expect(output).toContain("Workspace Saved Successfully");
    });

    it("should write stop spinner failure ANSI sequence and message to standard output", () => {
      terminal.showSpinner("Saving Workspace Status...");
      terminal.stopSpinner(false, "Workspace Save Failed");

      const output = capturedOutput.join("");
      expect(output).toContain("\x1b[?25h");
      expect(output).toContain("✖");
      expect(output).toContain("Workspace Save Failed");
    });
  });

  describe("Structured Error Displays (displayTerminalError)", () => {
    it("should color and structure terminal errors in red", () => {
      terminal.displayTerminalError("Failed to execute command");

      const output = capturedOutput.join("");
      // Verify Red ANSI color code \x1b[31m and error marker
      expect(output).toContain("\x1b[31m");
      expect(output).toContain("Failed to execute command");
      expect(output).toContain("\x1b[0m"); // reset ANSI code
    });
  });

  describe("Colorized Diff Views (renderDiffView)", () => {
    it("should format positive diff lines in green and negative diff lines in red", () => {
      const diffPayload = [
        "  const a = 1;",
        "- const b = 2;",
        "+ const b = 3;",
        "  const c = 4;",
      ].join("\n");

      terminal.renderDiffView(diffPayload);

      const output = capturedOutput.join("");

      // Asserting neutral lines are grey/unstyled or preserved
      expect(output).toContain("const a = 1;");

      // Red styling for negative diff line (\x1b[31m)
      expect(output).toContain("\x1b[31m- const b = 2;");

      // Green styling for positive diff line (\x1b[32m)
      expect(output).toContain("\x1b[32m+ const b = 3;");
    });
  });

  describe("Out of Scope Fallbacks", () => {
    it("should default approval prompt to true without raising unexpected errors", async () => {
      const approvalResult =
        await terminal.requestUserApproval("Approve execution?");
      expect(approvalResult).toBe(true);
    });
  });
});
