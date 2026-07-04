import { execSync } from "node:child_process";
import { SafeCommandValidator } from "./SafeCommandValidator.js";

export interface CommandTemplates {
  [commandKey: string]: string;
}

export interface ParameterizedSafeCommand {
  commandKey: string;
  argumentTarget: string;
}

/**
 * Handles executing predefined, parameterized system testing commands within
 * a safe process sandbox, returning raw results or structured error trace payloads [REQ-04].
 */
export class SafeCommandExecutor {
  /**
   * Constructs the SafeCommandExecutor with a registry of allowed command templates.
   * @param templates - A map of command keys to command templates containing "{target}" placeholders.
   */
  constructor(private templates: CommandTemplates) {}

  /**
   * Validates arguments, replaces placeholders in the configured command template,
   * and executes the command within a shell wrapper, capturing stdout and stderr.
   *
   * @param commandKey - The identifier of the predefined command template.
   * @param argumentTarget - The target file path/argument to parameterize.
   * @throws Error if validation fails, template is missing, or execution fails with XML wrapping.
   */
  public async execute(
    commandKey: string,
    argumentTarget: string,
  ): Promise<string> {
    // 1. Validate target path to prevent command/directory injection attacks
    SafeCommandValidator.validateTargetPath(argumentTarget);

    // 2. Fetch the corresponding template
    const template = this.templates[commandKey];
    if (!template) {
      throw new Error(`Command key '${commandKey}' is not registered`);
    }

    // 3. Ensure template is properly formatted with placeholders
    if (!template.includes("{target}")) {
      throw new Error(
        `Template for '${commandKey}' is missing the '{target}' placeholder`,
      );
    }

    // 4. Replace placeholder safely
    const commandString = template.replace("{target}", argumentTarget);

    // 5. Execute process in isolation, capturing output streams
    try {
      const output = execSync(commandString, { stdio: "pipe" });
      return typeof output === "string" ? output : output.toString("utf-8");
    } catch (error: any) {
      let errorMsg = "";
      const stderrStr = error.stderr
        ? error.stderr.toString("utf-8").trim()
        : "";
      const stdoutStr = error.stdout
        ? error.stdout.toString("utf-8").trim()
        : "";

      if (stderrStr && stdoutStr) {
        errorMsg = `${stderrStr}\n${stdoutStr}`;
      } else if (stderrStr) {
        errorMsg = stderrStr;
      } else if (stdoutStr) {
        errorMsg = stdoutStr;
      } else {
        errorMsg = error.message || "Command terminated unexpectedly";
      }

      throw new Error(`<compiler_error>\n${errorMsg}\n</compiler_error>`);
    }
  }

  /**
   * High-level Sandbox execution bridge corresponding to the SandboxExecutor interface.
   *
   * @param command - ParameterizedSafeCommand payload.
   */
  public async executeCommand(
    command: ParameterizedSafeCommand,
  ): Promise<string> {
    return this.execute(command.commandKey, command.argumentTarget);
  }
}
