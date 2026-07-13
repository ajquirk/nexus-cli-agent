import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LLMOrchestrator,
  VercelLLMOrchestrator,
  StepRecord,
  ToolSpec,
  ChatMessage,
} from "./LLMOrchestrator.js";
import { generateText, LanguageModel } from "ai";
import { SQLiteStorageManager } from "../storage/SQLiteStorageManager.js";

vi.mock("ai", async () => {
  const original = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...original,
    generateText: vi.fn(),
  };
});

describe("LLMOrchestrator Orchestration & Retries", () => {
  let mockStorageManager: any;
  let mockSleep: any;
  const dummyModel = {} as LanguageModel;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSleep = vi.fn().mockResolvedValue(undefined);
    mockStorageManager = {
      getRateLimitCooldown: vi.fn().mockResolvedValue(null),
      logRateLimitCooldown: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("should return complete decision when model yields text response", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "Job complete!",
      toolCalls: [],
    } as any);

    const orchestrator = new VercelLLMOrchestrator({
      model: dummyModel,
    });

    const decision = await orchestrator.generateNextTurn("session-1", [], []);
    expect(decision).toEqual({
      type: "complete",
      message: "Job complete!",
    });
  });

  it("should return tool call decision when model targets a tool", async () => {
    vi.mocked(generateText).mockResolvedValue({
      toolCalls: [
        {
          toolCallId: "call_abc",
          toolName: "test_tool",
          input: { key: "val" },
        },
      ],
    } as any);

    const orchestrator = new VercelLLMOrchestrator({
      model: dummyModel,
    });

    const decision = await orchestrator.generateNextTurn("session-1", [], []);
    expect(decision).toEqual({
      type: "tool_call",
      toolCall: {
        id: "call_abc",
        name: "test_tool",
        args: { key: "val" },
      },
    });
  });

  it("should respect rate limit cooldowns saved in storage and wait if active", async () => {
    const futureEpoch = Date.now() + 5000;
    mockStorageManager.getRateLimitCooldown.mockResolvedValue(futureEpoch);

    vi.mocked(generateText).mockResolvedValue({
      text: "Resumed job",
    } as any);

    const orchestrator = new VercelLLMOrchestrator({
      model: dummyModel,
      storageManager: mockStorageManager as unknown as SQLiteStorageManager,
      sleepFn: mockSleep,
    });

    await orchestrator.generateNextTurn("session-1", [], []);
    expect(mockSleep).toHaveBeenCalled();
  });

  it("should retry on 429 exceptions and persist the rate-limit reset epoch to storage", async () => {
    const error429 = new Error("Rate limit exceeded");
    (error429 as any).status = 429;
    (error429 as any).headers = {
      get: (h: string) => (h === "retry-after" ? "3" : null),
    };

    vi.mocked(generateText)
      .mockRejectedValueOnce(error429)
      .mockResolvedValueOnce({
        text: "Recovered successfully",
      } as any);

    const orchestrator = new VercelLLMOrchestrator({
      model: dummyModel,
      storageManager: mockStorageManager as unknown as SQLiteStorageManager,
      sleepFn: mockSleep,
      maxRetries: 2,
    });

    const decision = await orchestrator.generateNextTurn("session-1", [], []);
    expect(decision.type).toBe("complete");
    expect(mockStorageManager.logRateLimitCooldown).toHaveBeenCalled();
    expect(mockSleep).toHaveBeenCalledWith(3000);
  });
});

describe("LLMOrchestrator.pruneContext", () => {
  const dummyModel = {} as LanguageModel;

  const createDummyHistory = (count: number): StepRecord[] => {
    return Array.from({ length: count }, (_, idx) => ({
      timestamp: new Date(2026, 6, 4, 12, idx).toISOString(),
      toolName: `test_tool_${idx}`,
      args: { param: idx },
      stdoutSummary: `Stdout outcome from tool ${idx}`,
      tokenCountEstimate: 10,
    }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return history unmodified if step length is less than or equal to 4", async () => {
    const history = createDummyHistory(4);
    const pruned = await LLMOrchestrator.pruneContext(history, {
      model: dummyModel,
    });

    expect(pruned).toHaveLength(4);
    expect(pruned).toEqual(history);
  });

  it("should return history unmodified if step length is empty", async () => {
    const history: StepRecord[] = [];
    const pruned = await LLMOrchestrator.pruneContext(history, {
      model: dummyModel,
    });

    expect(pruned).toHaveLength(0);
  });

  it("should condense history when step length is 5 using mocked LLM response", async () => {
    const history = createDummyHistory(5);

    vi.mocked(generateText).mockResolvedValue({
      text: "Summary of Step",
      finishReason: "stop",
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      rawResponse: {},
    } as any);

    const pruned = await LLMOrchestrator.pruneContext(history, {
      model: dummyModel,
    });

    // Assert that the returned array length is reduced to 4
    expect(pruned).toHaveLength(4);

    // Assert the first two records represent compressed summaries
    expect(pruned[0].toolName).toBe("summarized_history");
    expect(pruned[0].stdoutSummary).toBe("Summary of Step");
    expect(pruned[0].tokenCountEstimate).toBeGreaterThan(0);

    expect(pruned[1].toolName).toBe("summarized_history");
    expect(pruned[1].stdoutSummary).toBe("Summary of Step");

    // Assert the last two records preserve their detailed original properties (items index 3 and 4 of original history)
    expect(pruned[2]).toEqual(history[3]);
    expect(pruned[3]).toEqual(history[4]);
  });

  it("should use a custom summarization function if injected via options", async () => {
    const history = createDummyHistory(6);
    const customSummarizeFn = vi
      .fn()
      .mockResolvedValue("Custom Prompt Summary");

    const pruned = await LLMOrchestrator.pruneContext(history, {
      summarizeFn: customSummarizeFn,
    });

    expect(pruned).toHaveLength(4);
    expect(customSummarizeFn).toHaveBeenCalledTimes(2);

    expect(pruned[0].stdoutSummary).toBe("Custom Prompt Summary");
    expect(pruned[1].stdoutSummary).toBe("Custom Prompt Summary");

    // Last two preserve detailed original elements (indexes 4 and 5 of length 6)
    expect(pruned[2]).toEqual(history[4]);
    expect(pruned[3]).toEqual(history[5]);
  });

  it("should fall back gracefully to a static summary if no model or custom function is provided", async () => {
    const history = createDummyHistory(5);
    const pruned = await LLMOrchestrator.pruneContext(history);

    expect(pruned).toHaveLength(4);
    expect(pruned[0].stdoutSummary).toContain("Automatic summary");
    expect(pruned[1].stdoutSummary).toContain("Automatic summary");
  });
});

describe("VercelLLMOrchestrator PRD Turn Generation (TASK-09)", () => {
  let mockStorageManager: any;
  let mockSleep: any;
  const dummyModel = {} as LanguageModel;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSleep = vi.fn().mockResolvedValue(undefined);
    mockStorageManager = {
      getRateLimitCooldown: vi.fn().mockResolvedValue(null),
      logRateLimitCooldown: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("should inject the initial prompt as user message when history is empty (REQ-05)", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify({
        thought: "Analyzing the empty state task.",
        suggestedAction: {
          type: "patch",
          payload: {
            filePath: "src/db.ts",
            find: "timeout: 1000",
            replace: "timeout: 5000",
          },
        },
        isTerminal: false,
      }),
    } as any);

    const orchestrator = new VercelLLMOrchestrator({
      model: dummyModel,
    });

    const result = await orchestrator.generateNextTurn(
      "Refactor users database controller",
      [],
    );

    expect(generateText).toHaveBeenCalled();
    const calls = vi.mocked(generateText).mock.calls;
    const lastCallArgs = calls[calls.length - 1][0] as any;

    expect(lastCallArgs.messages).toBeDefined();
    const messages = lastCallArgs.messages as any[];
    const firstMsg = messages[0];
    expect(firstMsg).toEqual({
      role: "user",
      content: "Refactor users database controller",
    });

    expect(result.thought).toBe("Analyzing the empty state task.");
    expect(result.suggestedAction).toEqual({
      type: "patch",
      payload: {
        filePath: "src/db.ts",
        find: "timeout: 1000",
        replace: "timeout: 5000",
      },
    });
    expect(result.isTerminal).toBe(false);
  });

  it("should preserve and transmit the existing ChatHistory list when not empty", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify({
        thought: "Moving to next step.",
        isTerminal: true,
      }),
    } as any);

    const orchestrator = new VercelLLMOrchestrator({
      model: dummyModel,
    });

    const history: ChatMessage[] = [
      { role: "user", content: "Implement unique constraint on email" },
      {
        role: "assistant",
        content: JSON.stringify({
          thought: "Applying index",
          isTerminal: false,
        }),
      },
    ];

    await orchestrator.generateNextTurn(
      "Implement unique constraint on email",
      history,
    );

    expect(generateText).toHaveBeenCalled();
    const calls = vi.mocked(generateText).mock.calls;
    const lastCallArgs = calls[calls.length - 1][0] as any;

    expect(lastCallArgs.messages).toBeDefined();
    const messages = lastCallArgs.messages as any[];
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: "user",
      content: "Implement unique constraint on email",
    });
    expect(messages[1].role).toBe("assistant");
  });

  it("should reliably parse structured JSON wrapped in markdown blocks", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: '```json\n{\n  "thought": "Parsing markdown JSON success",\n  "isTerminal": true\n}\n```',
    } as any);

    const orchestrator = new VercelLLMOrchestrator({
      model: dummyModel,
    });

    const result = await orchestrator.generateNextTurn("Do task", []);
    expect(result).toEqual({
      thought: "Parsing markdown JSON success",
      isTerminal: true,
    });
  });

  it("should fall back gracefully to treating raw text response as thought when JSON parsing fails", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "I have successfully refactored the database code and ran all tests manually.",
    } as any);

    const orchestrator = new VercelLLMOrchestrator({
      model: dummyModel,
    });

    const result = await orchestrator.generateNextTurn("Do task", []);
    expect(result.thought).toBe(
      "I have successfully refactored the database code and ran all tests manually.",
    );
    expect(result.isTerminal).toBe(false);
    expect(result.suggestedAction).toBeUndefined();
  });
});
