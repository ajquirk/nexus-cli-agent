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
}

/**
 * Concrete implementation of TerminalInterface using @clack/prompts
 * and custom dependency-free ANSI colored layouts.
 */
export class ClackTerminalInterface implements TerminalInterface {
  private stdoutWriter: { write(str: string): boolean };
  private activeSpinner: any = null;

  constructor(options?: ClackTerminalInterfaceOptions) {
    this.stdoutWriter = options?.stdout || {
      write: (str: string) => process.stdout.write(str),
    };
  }

  /**
   * Starts and displays a visual non-blocking loading spinner.
   */
  showSpinner(message: string): void {
    if (this.activeSpinner) {
      // Gracefully stop any existing spinner before starting a new one
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
   * Request user interactive approval. (Out of scope for visual tasks - stubbed).
   */
  async requestUserApproval(promptMessage: string): Promise<boolean> {
    return true;
  }

  /**
   * Renders colorized visual side-by-side or block-level diff updates.
   */
  renderDiffView(diffText: string): void {
    const lines = diffText.split("\n");
    for (const line of lines) {
      if (line.startsWith("+")) {
        // Green color for added lines
        this.stdoutWriter.write(`\x1b[32m${line}\x1b[0m\n`);
      } else if (line.startsWith("-")) {
        // Red color for removed lines
        this.stdoutWriter.write(`\x1b[31m${line}\x1b[0m\n`);
      } else {
        // Grey color for context lines
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
