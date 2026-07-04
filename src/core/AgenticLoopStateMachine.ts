// src/core/AgenticLoopStateMachine.ts
import {
  SQLiteStorageManager,
  StepRecord,
} from "../storage/SQLiteStorageManager.js";
import {
  LLMOrchestrator,
  ToolSpec,
  AgenticDecision,
} from "../llm/LLMOrchestrator.js";
import {
  TerminalInterface,
  SearchReplaceBlock,
  ParameterizedSafeCommand,
} from "../terminal/TerminalInterface.js";

export interface SandboxExecutor {
  applySandboxBranch(taskId: string): Promise<void>;
  restoreOriginalBranch(): Promise<void>;
  mergeSandboxBranch(): Promise<void>;
  applyCodePatch(filePath: string, block: SearchReplaceBlock): Promise<void>;
  executeCommand(command: ParameterizedSafeCommand): Promise<string>;
}

export interface AgenticLoopStateMachineOptions {
  storageManager: SQLiteStorageManager;
  orchestrator: LLMOrchestrator;
  sandboxExecutor: SandboxExecutor;
  terminalInterface?: TerminalInterface;
  stepLimit?: number;
}

export class AgenticLoopStateMachine {
  private storageManager: SQLiteStorageManager;
  private orchestrator: LLMOrchestrator;
  private sandboxExecutor: SandboxExecutor;
  private terminalInterface?: TerminalInterface;
  private stepLimit: number;

  constructor(options: AgenticLoopStateMachineOptions) {
    this.storageManager = options.storageManager;
    this.orchestrator = options.orchestrator;
    this.sandboxExecutor = options.sandboxExecutor;
    this.terminalInterface = options.terminalInterface;
    this.stepLimit = options.stepLimit ?? 10;
  }

  /**
   * Evaluates user intent and executes the multi-step orchestrator state cycle.
   */
  async start(prompt: string): Promise<void> {
    // 1. Initialize SQLite database
    await this.storageManager.initializeDatabase();

    // 2. Generate unique sessionId for isolation tracking
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    this.terminalInterface?.showSpinner(
      "Initializing sandbox branch for task execution...",
    );

    try {
      // 3. Apply isolated sandbox branch
      await this.sandboxExecutor.applySandboxBranch(sessionId);
      this.terminalInterface?.stopSpinner(true, "Sandbox branch initialized.");

      let stepIndex = 0;

      // Define safe standard tools exposed to the LLM agentic workflow
      const availableTools: ToolSpec[] = [
        {
          name: "apply_patch",
          description:
            "Apply a targeted search-and-replace block to change files.",
          parameters: {
            type: "object",
            properties: {
              filePath: { type: "string" },
              find: { type: "string" },
              replace: { type: "string" },
            },
            required: ["filePath", "find", "replace"],
          },
        },
        {
          name: "execute_command",
          description:
            "Execute a safe parameterized system execution template.",
          parameters: {
            type: "object",
            properties: {
              commandKey: { type: "string" },
              argumentTarget: { type: "string" },
            },
            required: ["commandKey", "argumentTarget"],
          },
        },
      ];

      // 4. Autonomous Agentic Loop
      while (true) {
        // Retrieve logged step history for contextual awareness
        const history = await this.storageManager.getSessionHistory(sessionId);

        // Enforce hard step limits to protect host environments (REQ-02)
        if (stepIndex >= this.stepLimit) {
          throw new Error(
            `Step Limit limit of ${this.stepLimit} reached. Terminating loop to prevent runaway behavior`,
          );
        }

        this.terminalInterface?.showSpinner(
          `Evaluating intent & deciding next action (Step ${stepIndex + 1}/${this.stepLimit})...`,
        );

        // Generate the next decision sequence
        const decision = await this.orchestrator.generateNextTurn(
          sessionId,
          history,
          availableTools,
        );

        this.terminalInterface?.stopSpinner(true);

        // Handle terminal transition types: complete
        if (decision.type === "complete") {
          const completeRecord: StepRecord = {
            timestamp: new Date().toISOString(),
            toolName: "complete",
            args: { message: decision.message ?? "" },
            stdoutSummary: decision.message,
            tokenCountEstimate: 50,
          };
          await this.storageManager.saveStep(
            sessionId,
            stepIndex,
            completeRecord,
          );

          this.terminalInterface?.showSpinner(
            "Merging validated sandbox branch edits...",
          );
          await this.sandboxExecutor.mergeSandboxBranch();
          this.terminalInterface?.stopSpinner(
            true,
            "Sandbox branch merged successfully.",
          );
          break;
        }

        // Handle terminal transition types: fail
        if (decision.type === "fail") {
          throw new Error(
            `Agent execution failed: ${decision.message || "Unknown model refusal"}`,
          );
        }

        // Handle execution turn types: tool_call
        if (decision.type === "tool_call" && decision.toolCall) {
          const tool = decision.toolCall;
          this.terminalInterface?.showSpinner(
            `Executing step action: ${tool.name}...`,
          );

          let stdoutSummary = "";

          if (tool.name === "apply_patch") {
            const patchArgs = tool.args as {
              filePath: string;
              find: string;
              replace: string;
            };
            const block: SearchReplaceBlock = {
              filePath: patchArgs.filePath,
              find: patchArgs.find,
              replace: patchArgs.replace,
            };
            await this.sandboxExecutor.applyCodePatch(
              patchArgs.filePath,
              block,
            );
            stdoutSummary = `Successfully applied code patch to ${patchArgs.filePath}`;
          } else if (tool.name === "execute_command") {
            const cmdArgs = tool.args as {
              commandKey: string;
              argumentTarget: string;
            };
            const cmd: ParameterizedSafeCommand = {
              commandKey: cmdArgs.commandKey,
              argumentTarget: cmdArgs.argumentTarget,
            };
            stdoutSummary = await this.sandboxExecutor.executeCommand(cmd);
          } else {
            throw new Error(`Unsupported tool action received: ${tool.name}`);
          }

          // Persist the executed action and output result to SQLite WAL log (REQ-01)
          const stepRecord: StepRecord = {
            timestamp: new Date().toISOString(),
            toolName: tool.name,
            args: tool.args,
            stdoutSummary,
            tokenCountEstimate: Math.max(
              20,
              Math.ceil(stdoutSummary.length / 4),
            ),
          };

          await this.storageManager.saveStep(sessionId, stepIndex, stepRecord);
          this.terminalInterface?.stopSpinner(
            true,
            `Action ${tool.name} finished successfully.`,
          );

          stepIndex++;
        } else {
          throw new Error(
            "Invalid or unsupported decision received from orchestrator.",
          );
        }
      }
    } catch (err: any) {
      this.terminalInterface?.stopSpinner(
        false,
        "Error occurred during execution.",
      );

      // Discard branch edits and switch back to target original branch
      await this.sandboxExecutor.restoreOriginalBranch();

      if (this.terminalInterface) {
        this.terminalInterface.displayTerminalError(err.message || String(err));
      }
      throw err;
    }
  }
}
