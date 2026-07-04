import { generateText, jsonSchema, LanguageModel } from "ai";
import { SQLiteStorageManager } from "../storage/SQLiteStorageManager.js";

export interface StepRecord {
  timestamp: string;
  toolName: string;
  args: Record<string, any>;
  stdoutSummary?: string;
  tokenCountEstimate: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface AgenticDecision {
  type: "tool_call" | "complete" | "fail";
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, any>;
  };
  message?: string;
}

export interface LLMOrchestrator {
  generateNextTurn(
    sessionId: string,
    currentHistory: StepRecord[],
    availableTools: ToolSpec[],
  ): Promise<AgenticDecision>;
}

export namespace LLMOrchestrator {
  export interface PruneOptions {
    model?: LanguageModel;
    summarizeFn?: (steps: StepRecord[]) => Promise<string>;
  }

  /**
   * Summarizes system events that occurred more than 4 steps back.
   * Keeps the last 2 actions in raw format, while compressing prior
   * steps using dedicated LLM/API summarization.
   */
  export async function pruneContext(
    history: StepRecord[],
    options?: PruneOptions,
  ): Promise<StepRecord[]> {
    if (history.length <= 4) {
      return [...history];
    }

    const lastTwoIndex = history.length - 2;
    const rawSteps = history.slice(lastTwoIndex);
    const olderSteps = history.slice(0, lastTwoIndex);

    // Grouping the older elements into exactly 2 clusters
    const group1 = olderSteps.slice(0, olderSteps.length - 1);
    const group2 = [olderSteps[olderSteps.length - 1]];

    const summarizeGroup = async (group: StepRecord[]): Promise<StepRecord> => {
      let summaryText = "";

      if (options?.summarizeFn) {
        summaryText = await options.summarizeFn(group);
      } else if (options?.model) {
        const prompt = `Summarize the following tool execution steps into a single cohesive summary. Focus on what was done and what the results were:

${group
  .map(
    (g, idx) => `Step ${idx + 1}:
Tool: ${g.toolName}
Arguments: ${JSON.stringify(g.args)}
Output: ${g.stdoutSummary || "(no output)"}`,
  )
  .join("\n\n")}`;

        const response = await generateText({
          model: options.model,
          prompt,
        });
        summaryText = response.text || "Summary of Step";
      } else {
        const toolList = group.map((g) => g.toolName).join(", ");
        summaryText = `Automatic summary of step execution. Included tools: ${toolList}`;
      }

      const lastElement = group[group.length - 1];
      return {
        timestamp: lastElement?.timestamp || new Date().toISOString(),
        toolName: "summarized_history",
        args: {
          summarizedStepsCount: group.length,
          toolNames: group.map((g) => g.toolName),
        },
        stdoutSummary: summaryText,
        tokenCountEstimate: Math.max(10, Math.ceil(summaryText.length / 4)),
      };
    };

    const [sum1, sum2] = await Promise.all([
      summarizeGroup(group1),
      summarizeGroup(group2),
    ]);

    return [sum1, sum2, ...rawSteps];
  }
}

export interface LLMOrchestratorOptions {
  model: LanguageModel;
  systemInstruction?: string;
  providerName?: string;
  storageManager?: SQLiteStorageManager;
  sleepFn?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

export class VercelLLMOrchestrator implements LLMOrchestrator {
  private model: LanguageModel;
  private systemInstruction: string;
  private providerName: string;
  private storageManager?: SQLiteStorageManager;
  private sleepFn: (ms: number) => Promise<void>;
  private maxRetries: number;

  constructor(options: LLMOrchestratorOptions) {
    this.model = options.model;
    this.systemInstruction =
      options.systemInstruction || "You are a helpful assistant.";
    this.providerName = options.providerName || "default-provider";
    this.storageManager = options.storageManager;
    this.sleepFn =
      options.sleepFn ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
  }

  /**
   * Transforms internal step history into the unified Vercel AI SDK chat schema,
   * configures tool mappings, and returns the next agentic decision.
   * Integrates proactive cooldown checking and exponential retry handling.
   */
  async generateNextTurn(
    sessionId: string,
    currentHistory: StepRecord[],
    availableTools: ToolSpec[],
  ): Promise<AgenticDecision> {
    const messages: any[] = [];
    for (let i = 0; i < currentHistory.length; i++) {
      const step = currentHistory[i];
      const toolCallId = `call_${sessionId}_${i}`;

      messages.push({
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId,
            toolName: step.toolName,
            args: step.args,
          },
        ],
      });

      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId,
            toolName: step.toolName,
            result: step.stdoutSummary ?? "",
          },
        ],
      });
    }

    const tools: Record<string, any> = {};
    for (const spec of availableTools) {
      tools[spec.name] = {
        description: spec.description,
        parameters: jsonSchema(spec.parameters),
      };
    }

    let attempts = 0;

    while (true) {
      try {
        if (this.storageManager) {
          const resetEpochMs = await this.storageManager.getRateLimitCooldown(
            this.providerName,
          );
          if (resetEpochMs && resetEpochMs > Date.now()) {
            const waitTime = resetEpochMs - Date.now();
            if (waitTime > 0) {
              await this.sleepFn(waitTime);
            }
          }
        }

        const response = await generateText({
          model: this.model,
          system: this.systemInstruction,
          messages,
          tools,
        });

        if (response.toolCalls && response.toolCalls.length > 0) {
          const primaryCall = response.toolCalls[0];
          return {
            type: "tool_call",
            toolCall: {
              id: primaryCall.toolCallId,
              name: primaryCall.toolName,
              args: (primaryCall.input as Record<string, any>) || {},
            },
          };
        }

        if (response.text && response.text.trim().length > 0) {
          return {
            type: "complete",
            message: response.text,
          };
        }

        return {
          type: "fail",
          message:
            "No content or tool execution instructions generated by the model.",
        };
      } catch (error: any) {
        const is429 =
          error &&
          (error.status === 429 ||
            error.statusCode === 429 ||
            (typeof error.message === "string" &&
              (error.message.includes("429") ||
                error.message.toLowerCase().includes("rate limit") ||
                error.message.toLowerCase().includes("rate_limit"))));

        if (is429 && attempts < this.maxRetries) {
          attempts++;

          let retryAfterSecs = 2;
          const headerVal =
            error.headers?.get?.("retry-after") ??
            error.headers?.["retry-after"] ??
            error.response?.headers?.get?.("retry-after") ??
            error.response?.headers?.["retry-after"];

          if (headerVal !== undefined && headerVal !== null) {
            const parsed = parseInt(String(headerVal), 10);
            if (!isNaN(parsed) && parsed >= 0) {
              retryAfterSecs = parsed;
            }
          }

          const retryAfterMs = retryAfterSecs * 1000;
          const resetEpochMs = Date.now() + retryAfterMs;

          if (this.storageManager) {
            await this.storageManager.logRateLimitCooldown(
              this.providerName,
              resetEpochMs,
            );
          }

          await this.sleepFn(retryAfterMs);
          continue;
        }

        return {
          type: "fail",
          message: error?.message || "An unknown orchestration error occurred.",
        };
      }
    }
  }
}
