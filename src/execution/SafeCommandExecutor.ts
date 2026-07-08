import { execSync, spawn } from "node:child_process";
import { SafeCommandValidator } from "./SafeCommandValidator.js";
import { IConfigManager } from "../config/ConfigManager.js";

export interface CommandTemplates {
  [commandKey: string]: string;
}

export interface ParameterizedSafeCommand {
  commandKey: string;
  argumentTarget: string;
}

export interface CommandExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Handles executing predefined, parameterized system testing commands within
 * a safe process sandbox, returning raw results or structured error trace payloads [REQ-04].
 */
export class SafeCommandExecutor {
  private configManager?: IConfigManager;

  /**
   * Constructs the SafeCommandExecutor with a registry of allowed command templates.
   * @param templates - A map of command keys to command templates containing "{target}" placeholders.
   * @param configManager - Optional ConfigManager instance to load dynamic structured templates.
   */
  constructor(
    private templates: CommandTemplates,
    configManager?: IConfigManager,
  ) {
    this.configManager = configManager;
  }

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
   * Overloaded executeCommand method supporting both:
   * 1. The original ParameterizedSafeCommand interface returning string.
   * 2. The PRD Module 4 interface with templateKey and variables returning CommandExecutionResult.
   */
  public async executeCommand(
    command: ParameterizedSafeCommand,
  ): Promise<string>;
  public async executeCommand(
    templateKey: string,
    variables: Record<string, string>,
  ): Promise<CommandExecutionResult>;
  public async executeCommand(
    first: ParameterizedSafeCommand | string,
    second?: Record<string, string>,
  ): Promise<string | CommandExecutionResult> {
    // 1. Handle original signature (returning Promise<string>)
    if (typeof first === "object" && first !== null && "commandKey" in first) {
      return this.execute(first.commandKey, first.argumentTarget);
    }

    // 2. Handle new signature (returning Promise<CommandExecutionResult>) [REQ-03]
    if (typeof first === "string") {
      const templateKey = first;
      const variables = second || {};

      // Retrieve the template as an array of strings
      let template: string[];
      if (this.configManager) {
        template = await this.configManager.getCommandTemplate(templateKey);
      } else {
        const rawTemplate = this.templates[templateKey];
        if (!rawTemplate) {
          throw new Error(`Command template '${templateKey}' was not found.`);
        }
        // Fallback split logic for backward compatibility with string templates
        template = rawTemplate.split(/\s+/);
      }

      if (!template || template.length === 0) {
        throw new Error(`Command template '${templateKey}' is empty.`);
      }

      // Substitute variables index-by-index in the array [Conflict 3]
      const substituted = template.map((arg) => {
        let result = arg;
        for (const [key, value] of Object.entries(variables)) {
          result = result.replaceAll(`{${key}}`, value);
        }
        return result;
      });

      // Spawn process shell-less with shell: false hardcoded [REQ-03]
      const [executable, ...args] = substituted;
      if (!executable) {
        throw new Error(
          `Invalid executable in command template '${templateKey}'.`,
        );
      }

      return new Promise<CommandExecutionResult>((resolve, reject) => {
        const child = spawn(executable, args, { shell: false });

        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (chunk) => {
          stdout += chunk.toString();
        });

        child.stderr?.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        child.on("error", (err) => {
          reject(err);
        });

        child.on("close", (code) => {
          resolve({
            stdout,
            stderr,
            exitCode: code ?? 0,
          });
        });
      });
    }

    throw new Error("Invalid parameters provided to executeCommand.");
  }
}
