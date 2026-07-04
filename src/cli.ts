import { ConfigManager } from "./config/ConfigManager.js";
import { AgenticLoopStateMachine } from "./core/AgenticLoopStateMachine.js";
import { SQLiteStorageManagerImpl } from "./storage/SQLiteStorageManager.js";
import { ClackTerminalInterface } from "./terminal/TerminalInterface.js";

export interface CLIOptions {
  /**
   * Overrides the home directory path for configurations (~/.config/nexus)
   */
  homeDir?: string;
  /**
   * Overrides the workspace root directory path (where agent.config.json is created)
   */
  workspaceDir?: string;
  /**
   * Optional custom implementations for testing dependency injection
   */
  storageManager?: any;
  orchestrator?: any;
  sandboxExecutor?: any;
  terminalInterface?: any;
  stepLimit?: number;
}

/**
 * Entry point for parsing CLI arguments and executing the corresponding commands.
 *
 * @param argv Command line argument array (defaults to process.argv)
 * @param options Dependency overrides and configuration directory overrides
 */
export async function runCLI(
  argv?: string[],
  options?: CLIOptions,
): Promise<void> {
  const args = argv || process.argv;
  const command = args[2];

  if (!command) {
    throw new Error(
      "No command provided. Please specify 'init' or 'run <prompt>'.",
    );
  }

  // 1. Handle "nexus init" command
  if (command === "init") {
    const configManager = new ConfigManager({
      homeDir: options?.homeDir,
      workspaceDir: options?.workspaceDir,
    });
    await configManager.initializeConfig();
    return;
  }

  // 2. Handle "nexus run <prompt>" command
  if (command === "run") {
    const prompt = args.slice(3).join(" ");
    if (!prompt || prompt.trim() === "") {
      throw new Error(
        "Missing prompt. Please provide a description of the task.",
      );
    }

    // Resolve storage and terminal to concrete implementations
    const storageManager =
      options?.storageManager ||
      new SQLiteStorageManagerImpl({
        databasePath: options?.homeDir
          ? `${options.homeDir}/.config/nexus/history.db`
          : undefined,
      });

    const terminalInterface =
      options?.terminalInterface || new ClackTerminalInterface();

    // Since LLM model mapping and unified sandbox executors are part of separate/subsequent tasks,
    // we require them to be provided via dependency injection (which our tests do).
    const orchestrator = options?.orchestrator;
    if (!orchestrator) {
      throw new Error(
        "LLMOrchestrator is not yet configured or implemented for production execution.",
      );
    }

    const sandboxExecutor = options?.sandboxExecutor;
    if (!sandboxExecutor) {
      throw new Error(
        "SandboxExecutor is not yet configured or implemented for production execution.",
      );
    }

    const stateMachine = new AgenticLoopStateMachine({
      storageManager,
      orchestrator,
      sandboxExecutor,
      terminalInterface,
      stepLimit: options?.stepLimit,
    });

    await stateMachine.start(prompt);
    return;
  }

  // 3. Handle unsupported commands
  throw new Error(`Unsupported command: ${command}`);
}
