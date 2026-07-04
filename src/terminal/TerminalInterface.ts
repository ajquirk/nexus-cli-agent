import { spinner } from "@clack/prompts";

export interface SearchReplaceBlock {
  filePath: string;
  find: string;
  replace: string;
}

export interface ParameterizedSafeCommand {
  commandKey: string;
  argumentTarget: string;
}

export interface TerminalInterface {
  showSpinner(message: string): void;
  stopSpinner(success: boolean, message?: string): void;
  requestUserApproval(promptMessage: string): Promise<boolean>;
  renderDiffView(diffText: string): void;
  displayTerminalError(errorMessage: string): void;
}

export interface ClackTerminalInterfaceOptions {
  /**
   * Custom standard output writer to isolate testing side-effects.
   * Defaults to writing to process.stdout.
   */
  stdout?: { write(str: string): boolean };
  /**
   * Custom standard input reader to isolate testing side-effects.
   * Defaults to reading from process.stdin.
   */
  stdin?: NodeJS.ReadableStream;
}

/**
 * Concrete implementation of TerminalInterface using @clack/prompts
 * and custom dependency-free ANSI colored layouts.
 */
export class ClackTerminalInterface implements TerminalInterface {
  private stdoutWriter: { write(str: string): boolean };
  private stdinReader: NodeJS.ReadableStream;
  private activeSpinner: any = null;

  constructor(options?: ClackTerminalInterfaceOptions) {
    this.stdoutWriter = options?.stdout || {
      write: (str: string) => process.stdout.write(str),
    };
    this.stdinReader = options?.stdin || process.stdin;
  }

  /**
   * Starts and displays a visual non-blocking loading spinner.
   */
  showSpinner(message: string): void {
    if (this.activeSpinner) {
      this.activeSpinner.stop("Interrupted", 1);
    }
    this.activeSpinner = spinner();
    this.activeSpinner.start(message);
  }

  /**
   * Stops the active loading spinner and renders success or failure state.
   */
  stopSpinner(success: boolean, message?: string): void {
    if (this.activeSpinner) {
      const exitCode = success ? 0 : 1;
      this.activeSpinner.stop(message || "", exitCode);
      this.activeSpinner = null;
    }
  }

  /**
   * Request user interactive approval.
   */
  async requestUserApproval(promptMessage: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // Print the prompt with elegant styled formatting
      this.stdoutWriter.write(
        `\x1b[36m? \x1b[1m${promptMessage}\x1b[0m \x1b[90m(y/N) › \x1b[0m`,
      );

      const stdin = this.stdinReader;

      if (typeof (stdin as any).resume === "function") {
        (stdin as any).resume();
      }
      if (typeof (stdin as any).setEncoding === "function") {
        (stdin as any).setEncoding("utf8");
      }

      const onData = (chunk: Buffer | string) => {
        const input = chunk.toString().trim().toLowerCase();
        cleanup();
        if (input === "y" || input === "yes") {
          resolve(true);
        } else {
          resolve(false);
        }
      };

      const cleanup = () => {
        stdin.removeListener("data", onData);
        if (
          typeof (stdin as any).pause === "function" &&
          stdin === process.stdin
        ) {
          (stdin as any).pause();
        }
      };

      stdin.on("data", onData);
    });
  }

  /**
   * Renders colorized visual side-by-side or block-level diff updates.
   */
  renderDiffView(diffText: string): void {
    const lines = diffText.split("\n");
    for (const line of lines) {
      if (line.startsWith("---") || line.startsWith("+++")) {
        // Distinct grey styling for standard git metadata headers
        this.stdoutWriter.write(`\x1b[90m${line}\x1b[0m\n`);
      } else if (line.startsWith("+")) {
        // Green color for added lines
        this.stdoutWriter.write(`\x1b[32m${line}\x1b[0m\n`);
      } else if (line.startsWith("-")) {
        // Red color for removed lines
        this.stdoutWriter.write(`\x1b[31m${line}\x1b[0m\n`);
      } else if (line.startsWith("@@")) {
        // Cyan color for hunk headers
        this.stdoutWriter.write(`\x1b[36m${line}\x1b[0m\n`);
      } else {
        // Grey color for unchanged context lines
        this.stdoutWriter.write(`\x1b[90m${line}\x1b[0m\n`);
      }
    }
  }

  /**
   * Renders structured system or parsing error displays.
   */
  displayTerminalError(errorMessage: string): void {
    this.stdoutWriter.write(`\x1b[31m✖ Error: ${errorMessage}\x1b[0m\n`);
  }
}
