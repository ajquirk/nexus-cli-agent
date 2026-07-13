// src/core/AgenticLoopStateMachine.ts
import { SQLiteStorageManager } from "../storage/SQLiteStorageManager.js";
import {
  LLMOrchestrator,
  ToolSpec,
  AgenticDecision,
  StepRecord,
  ChatMessage,
  LLMTurnResult,
} from "../llm/LLMOrchestrator.js";
import {
  TerminalInterface,
  SearchReplaceBlock,
  ParameterizedSafeCommand,
} from "../terminal/TerminalInterface.js";
import {
  WorkspaceSandboxExecutor,
  SearchReplacePatch,
} from "../execution/WorkspaceSandboxExecutor.js";

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
  sandboxExecutor?: SandboxExecutor; // Made optional for backward-compatible fallback
  workspaceSandboxExecutor?: WorkspaceSandboxExecutor; // Added for [TASK-12]
  terminalInterface?: TerminalInterface;
  stepLimit?: number;
  maxContextTokens?: number; // Configurable context limit for context pruning
}

export interface LoopCompletionStatus {
  status: "complete" | "fail";
  summary: string;
}

export class AgenticLoopStateMachine {
  private storageManager: SQLiteStorageManager;
  private orchestrator: LLMOrchestrator;
  private sandboxExecutor?: SandboxExecutor; // Made optional
  private workspaceSandboxExecutor?: WorkspaceSandboxExecutor; // Added for [TASK-12]
  private terminalInterface?: TerminalInterface;
  private stepLimit: number;
  private maxContextTokens?: number;

  constructor(options: AgenticLoopStateMachineOptions) {
    this.storageManager = options.storageManager;
    this.orchestrator = options.orchestrator;
    this.sandboxExecutor = options.sandboxExecutor;
    this.workspaceSandboxExecutor = options.workspaceSandboxExecutor;
    this.terminalInterface = options.terminalInterface;
    this.stepLimit = options.stepLimit ?? 10;
    this.maxContextTokens = options.maxContextTokens;
  }

  /**
   * Promoted PRD-based executeLoop method [TASK-11]
   * Manages loop state transitions, integrates spinners, tracks runtimes, and prunes context.
   */
  async executeLoop(
    taskId: string,
    userInstruction: string,
  ): Promise<LoopCompletionStatus> {
    let isInterrupted = false;
    let sigintHandler: (() => void) | null = null;

    // Set up process interrupt promise wrapper to race against active loop execution
    let rejectInterrupt: (reason: any) => void;
    const interruptPromise = new Promise<never>((_, reject) => {
      rejectInterrupt = reject;
    });

    sigintHandler = async () => {
      if (isInterrupted) return;
      isInterrupted = true;

      try {
        this.terminalInterface?.stopSpinner(false, "Interrupted by user.");

        const retain = this.terminalInterface
          ? await this.terminalInterface.requestUserApproval(
              "Do you want to retain the sandbox branch?",
            )
          : false;

        if (!retain) {
          if (this.workspaceSandboxExecutor) {
            await this.workspaceSandboxExecutor.finalizeWorkspace(
              taskId,
              false,
            );
          } else {
            await this.sandboxExecutor!.restoreOriginalBranch();
          }
        }

        rejectInterrupt(new Error("Execution interrupted by user (SIGINT)"));
      } catch (err) {
        rejectInterrupt(err);
      }
    };

    process.on("SIGINT", sigintHandler);

    try {
      const loopPromise = (async (): Promise<LoopCompletionStatus> => {
        this.terminalInterface?.showSpinner(
          `Initializing sandbox environment for task ${taskId}...`,
        );
        try {
          if (this.workspaceSandboxExecutor) {
            await this.workspaceSandboxExecutor.initializeWorkspace(taskId);
          } else {
            await this.sandboxExecutor!.applySandboxBranch(taskId);
          }
          this.terminalInterface?.stopSpinner(
            true,
            "Sandbox environment initialized.",
          );
        } catch (error: any) {
          this.terminalInterface?.stopSpinner(
            false,
            "Failed to initialize sandbox environment.",
          );
          return {
            status: "fail",
            summary: `Initialization failed: ${error.message || String(error)}`,
          };
        }

        const history: ChatMessage[] = [];
        history.push({ role: "user", content: userInstruction });

        let cycleCount = 0;

        while (true) {
          cycleCount++;

          if (cycleCount > this.stepLimit) {
            this.terminalInterface?.showSpinner(
              "Reverting changes due to loop exhaustion...",
            );
            try {
              if (this.workspaceSandboxExecutor) {
                await this.workspaceSandboxExecutor.finalizeWorkspace(
                  taskId,
                  false,
                );
              } else {
                await this.sandboxExecutor!.restoreOriginalBranch();
              }
            } catch (rollbackError) {
              // Suppress secondary rollback failures
            }
            this.terminalInterface?.stopSpinner(false, "Loop exhausted.");
            return {
              status: "fail",
              summary: `Loop count exhaustion. Step Limit limit of ${this.stepLimit} reached.`,
            };
          }

          // Check context pruning thresholds (REQ-06)
          const totalChars = history.reduce(
            (acc, msg) => acc + (msg.content?.length || 0),
            0,
          );
          const estimatedTokens = Math.ceil(totalChars / 4);
          const maxTokens = this.maxContextTokens ?? 4000;

          if (estimatedTokens > maxTokens * 0.8 || cycleCount > 15) {
            this.terminalInterface?.showSpinner(
              "Compressing historical conversations (context pruning)...",
            );
            try {
              const pruned = await this.orchestrator.pruneContext(history);
              // Re-assign history with pruned context
              history.length = 0;
              history.push(...pruned);
              this.terminalInterface?.stopSpinner(
                true,
                "Context compressed successfully.",
              );
            } catch (pruneError) {
              this.terminalInterface?.stopSpinner(
                false,
                "Pruning failed. Continuing execution...",
              );
            }
          }

          this.terminalInterface?.showSpinner(
            `Evaluating intent & deciding next action (Step ${cycleCount}/${this.stepLimit})...`,
          );

          let turnResult: LLMTurnResult;
          try {
            turnResult = await this.orchestrator.generateNextTurn(
              userInstruction,
              history,
            );
            this.terminalInterface?.stopSpinner(true);
          } catch (err: any) {
            this.terminalInterface?.stopSpinner(
              false,
              "Error generating next turn.",
            );
            try {
              if (this.workspaceSandboxExecutor) {
                await this.workspaceSandboxExecutor.finalizeWorkspace(
                  taskId,
                  false,
                );
              } else {
                await this.sandboxExecutor!.restoreOriginalBranch();
              }
            } catch (rollbackError) {}
            return {
              status: "fail",
              summary: err.message || String(err),
            };
          }

          // Record assistant turn in history (REQ-05)
          let assistantContent = `Thought: ${turnResult.thought}`;
          if (turnResult.suggestedAction) {
            assistantContent += `\nSuggested Action: ${JSON.stringify(turnResult.suggestedAction)}`;
          }
          history.push({ role: "assistant", content: assistantContent });

          if (turnResult.isTerminal) {
            this.terminalInterface?.showSpinner(
              "Finalizing validated changes...",
            );
            try {
              if (this.workspaceSandboxExecutor) {
                await this.workspaceSandboxExecutor.finalizeWorkspace(
                  taskId,
                  true,
                );
              } else {
                await this.sandboxExecutor!.mergeSandboxBranch();
              }
              this.terminalInterface?.stopSpinner(
                true,
                "Changes merged successfully.",
              );
              return {
                status: "complete",
                summary: turnResult.thought,
              };
            } catch (mergeError: any) {
              this.terminalInterface?.stopSpinner(
                false,
                "Failed to finalize changes.",
              );
              try {
                if (this.workspaceSandboxExecutor) {
                  await this.workspaceSandboxExecutor.finalizeWorkspace(
                    taskId,
                    false,
                  );
                } else {
                  await this.sandboxExecutor!.restoreOriginalBranch();
                }
              } catch (rollbackError) {}
              return {
                status: "fail",
                summary: `Finalization failed: ${mergeError.message || String(mergeError)}`,
              };
            }
          }

          // Process suggested actions
          if (turnResult.suggestedAction) {
            const action = turnResult.suggestedAction;

            if (action.type === "patch") {
              const payload = action.payload;
              this.terminalInterface?.showSpinner(
                `Applying patch to ${payload.filePath}...`,
              );
              try {
                if (this.workspaceSandboxExecutor) {
                  await this.workspaceSandboxExecutor.executeModification(
                    taskId,
                    {
                      filePath: payload.filePath,
                      find: payload.find,
                      replace: payload.replace,
                    },
                  );
                } else {
                  await this.sandboxExecutor!.applyCodePatch(payload.filePath, {
                    filePath: payload.filePath,
                    find: payload.find,
                    replace: payload.replace,
                  });
                }
                this.terminalInterface?.stopSpinner(
                  true,
                  `Successfully patched ${payload.filePath}`,
                );
                history.push({
                  role: "user",
                  content: `System: Successfully applied code patch to ${payload.filePath}`,
                });
              } catch (patchError: any) {
                this.terminalInterface?.stopSpinner(
                  false,
                  `Patch execution failed: ${patchError.message}`,
                );
                try {
                  if (this.workspaceSandboxExecutor) {
                    await this.workspaceSandboxExecutor.finalizeWorkspace(
                      taskId,
                      false,
                    );
                  } else {
                    await this.sandboxExecutor!.restoreOriginalBranch();
                  }
                } catch (rollbackError) {}
                return {
                  status: "fail",
                  summary: patchError.message || String(patchError),
                };
              }
            } else if (action.type === "command") {
              const payload = action.payload;
              const argumentTarget =
                payload.variables?.target ||
                payload.variables?.argumentTarget ||
                (payload.variables
                  ? Object.values(payload.variables)[0]
                  : "") ||
                "";

              this.terminalInterface?.showSpinner(
                `Executing safe command template ${payload.templateKey}...`,
              );
              try {
                let stdoutSummary = "";
                if (this.workspaceSandboxExecutor) {
                  const variables = payload.variables || {};
                  if (argumentTarget && !variables.target) {
                    variables.target = argumentTarget;
                  }
                  const res =
                    await this.workspaceSandboxExecutor.executeVerification(
                      taskId,
                      payload.templateKey,
                      variables,
                    );
                  stdoutSummary = res.stdout;
                } else {
                  stdoutSummary = await this.sandboxExecutor!.executeCommand({
                    commandKey: payload.templateKey,
                    argumentTarget,
                  });
                }
                this.terminalInterface?.stopSpinner(
                  true,
                  "Command executed successfully.",
                );
                history.push({
                  role: "user",
                  content: `System: Command executed successfully.\nOutput:\n${stdoutSummary}`,
                });
              } catch (cmdError: any) {
                this.terminalInterface?.stopSpinner(
                  false,
                  `Command execution failed: ${cmdError.message}`,
                );
                try {
                  if (this.workspaceSandboxExecutor) {
                    await this.workspaceSandboxExecutor.finalizeWorkspace(
                      taskId,
                      false,
                    );
                  } else {
                    await this.sandboxExecutor!.restoreOriginalBranch();
                  }
                } catch (rollbackError) {}
                return {
                  status: "fail",
                  summary: cmdError.message || String(cmdError),
                };
              }
            } else {
              // Unsupported action type
              try {
                if (this.workspaceSandboxExecutor) {
                  await this.workspaceSandboxExecutor.finalizeWorkspace(
                    taskId,
                    false,
                  );
                } else {
                  await this.sandboxExecutor!.restoreOriginalBranch();
                }
              } catch (rollbackError) {}
              return {
                status: "fail",
                summary: `Unsupported action type: ${action.type}`,
              };
            }
          }
        }
      })();

      return await Promise.race([loopPromise, interruptPromise]);
    } finally {
      if (sigintHandler) {
        process.off("SIGINT", sigintHandler);
      }
    }
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

    let isInterrupted = false;
    let sigintHandler: (() => void) | null = null;
    let stepIndex = 0;

    try {
      // 3. Apply isolated sandbox branch
      await this.sandboxExecutor!.applySandboxBranch(sessionId);
      this.terminalInterface?.stopSpinner(true, "Sandbox branch initialized.");

      // Set up process interrupt promise wrapper
      let rejectInterrupt: (reason: any) => void;
      const interruptPromise = new Promise<void>((_, reject) => {
        rejectInterrupt = reject;
      });

      // Construct a closure-scoped SIGINT handler to prevent leakage and correctly log step state
      sigintHandler = async () => {
        if (isInterrupted) return;
        isInterrupted = true;

        try {
          this.terminalInterface?.stopSpinner(false, "Interrupted by user.");

          // Record the interrupt event cleanly in the SQLite WAL history log
          const interruptRecord: StepRecord = {
            timestamp: new Date().toISOString(),
            toolName: "sigint_interrupt",
            args: { message: "Process received SIGINT" },
            stdoutSummary: "Execution interrupted by user (SIGINT).",
            tokenCountEstimate: 0,
          };

          await this.storageManager.saveStep(
            sessionId,
            stepIndex,
            interruptRecord,
          );

          // Ask the developer if they wish to retain or discard the sandbox environment
          const retain = this.terminalInterface
            ? await this.terminalInterface.requestUserApproval(
                "Do you want to retain the sandbox branch?",
              )
            : false;

          if (!retain) {
            await this.sandboxExecutor!.restoreOriginalBranch();
          }

          rejectInterrupt(new Error("Execution interrupted by user (SIGINT)"));
        } catch (err) {
          rejectInterrupt(err);
        }
      };

      // Register listener to the current Node process
      process.on("SIGINT", sigintHandler);

      // Core Agentic loop sequence
      const loopPromise = (async () => {
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
          const history =
            await this.storageManager.getSessionHistory(sessionId);

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
            await this.sandboxExecutor!.mergeSandboxBranch();
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
              await this.sandboxExecutor!.applyCodePatch(
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
              stdoutSummary = await this.sandboxExecutor!.executeCommand(cmd);
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

            await this.storageManager.saveStep(
              sessionId,
              stepIndex,
              stepRecord,
            );
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
      })();

      // Race active loop execution against potential system interrupts
      await Promise.race([loopPromise, interruptPromise]);
    } catch (err: any) {
      // If the loop was interrupted by a SIGINT signal, skip double cleanup procedures
      if (isInterrupted) {
        throw err;
      }

      this.terminalInterface?.stopSpinner(
        false,
        "Error occurred during execution.",
      );

      // Discard branch edits and switch back to target original branch
      await this.sandboxExecutor!.restoreOriginalBranch();

      if (this.terminalInterface) {
        this.terminalInterface.displayTerminalError(err.message || String(err));
      }
      throw err;
    } finally {
      // Clean up signal registration to guarantee no event listener leaks
      if (sigintHandler) {
        process.off("SIGINT", sigintHandler);
      }
    }
  }
}
