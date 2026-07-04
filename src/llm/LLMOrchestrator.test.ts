import { describe, it, expect, vi, beforeEach } from "vitest";
import { VercelLLMOrchestrator, ToolSpec } from "./LLMOrchestrator.js";
import { generateText, LanguageModel } from "ai";
import { SQLiteStorageManager } from "../storage/SQLiteStorageManager.js";

// Mock the Vercel AI SDK core function
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

// A robust helper representing standard API call errors
class MockAPICallError extends Error {
  status: number;
  headers: { get: (key: string) => string | null; [key: string]: any };

  constructor(message: string, status: number, retryAfterValue: string | null) {
    super(message);
    this.name = "APICallError";
    this.status = status;
    this.headers = {
      get: (key: string) => {
        if (key.toLowerCase() === "retry-after") {
          return retryAfterValue;
        }
        return null;
      },
      "retry-after": retryAfterValue,
    };
  }
}

describe("VercelLLMOrchestrator with Rate Limiting & Cooldowns", () => {
  const mockModel = {} as unknown as LanguageModel;

  // Mocked DB interface
  let mockStorageManager: SQLiteStorageManager;
  let mockSleep: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStorageManager = {
      initializeDatabase: vi.fn(),
      saveStep: vi.fn(),
      getSessionHistory: vi.fn(),
      logRateLimitCooldown: vi.fn().mockResolvedValue(undefined),
      getRateLimitCooldown: vi.fn().mockResolvedValue(null),
    } as unknown as SQLiteStorageManager;

    mockSleep = vi.fn().mockResolvedValue(undefined);
  });

  // --- PRE-EXISTING BEHAVIOR TESTS ---

  it("should return a tool_call decision when the LLM generates a tool execution payload", async () => {
    const simulatedToolCall = {
      type: "tool-call" as const,
      toolCallId: "123",
      toolName: "read_file",
      input: { filePath: "src/config/ConfigManager.ts" },
    };

    vi.mocked(generateText).mockResolvedValueOnce({
      text: "",
      toolCalls: [simulatedToolCall],
      toolResults: [],
      finishReason: "tool-calls",
    } as any);

    const orchestrator = new VercelLLMOrchestrator({ model: mockModel });
    const availableTools: ToolSpec[] = [
      {
        name: "read_file",
        description: "Read local files safely",
        parameters: {
          type: "object",
          properties: { filePath: { type: "string" } },
          required: ["filePath"],
        },
      },
    ];

    const decision = await orchestrator.generateNextTurn(
      "session-1",
      [],
      availableTools,
    );

    expect(decision).toEqual({
      type: "tool_call",
      toolCall: {
        id: "123",
        name: "read_file",
        args: { filePath: "src/config/ConfigManager.ts" },
      },
    });
  });

  it("should return a complete decision when the LLM returns plain text with no tool calls", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Task is successfully complete.",
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
    } as any);

    const orchestrator = new VercelLLMOrchestrator({ model: mockModel });
    const decision = await orchestrator.generateNextTurn("session-1", [], []);

    expect(decision).toEqual({
      type: "complete",
      message: "Task is successfully complete.",
    });
  });

  // --- NEW RATE LIMIT & COOLDOWN TDD TESTS (REQ-07) ---

  it("should handle a 429 response by extracting headers, saving cooldown to DB, sleeping, and retrying", async () => {
    // 1. Setup mock sequence: First call throws 429, second call succeeds.
    const error429 = new MockAPICallError("Rate limit exceeded", 429, "1");

    vi.mocked(generateText)
      .mockRejectedValueOnce(error429)
      .mockResolvedValueOnce({
        text: "Success after backoff",
        toolCalls: [],
        toolResults: [],
        finishReason: "stop",
      } as any);

    const orchestrator = new VercelLLMOrchestrator({
      model: mockModel,
      providerName: "anthropic",
      storageManager: mockStorageManager,
      sleepFn: mockSleep,
    });

    const decision = await orchestrator.generateNextTurn("session-1", [], []);

    // 2. Assert decision is correct from successful second attempt
    expect(decision).toEqual({
      type: "complete",
      message: "Success after backoff",
    });

    // 3. Verify cooldown persisted in DB: retry-after is 1 second, check that reset timestamp logged is in the future
    expect(mockStorageManager.logRateLimitCooldown).toHaveBeenCalledTimes(1);
    const [provider, resetEpochMs] = vi.mocked(
      mockStorageManager.logRateLimitCooldown,
    ).mock.calls[0];
    expect(provider).toBe("anthropic");
    expect(resetEpochMs).toBeGreaterThan(Date.now());

    // 4. Verify sleep was triggered for 1000ms
    expect(mockSleep).toHaveBeenCalledTimes(1);
    expect(mockSleep).toHaveBeenCalledWith(1000);

    // 5. Verify generateText was called twice
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("should pause/delay before calling generateText if an active cooldown is found in the database", async () => {
    const futureTime = Date.now() + 5000; // 5-second active cooldown
    vi.mocked(mockStorageManager.getRateLimitCooldown).mockResolvedValueOnce(
      futureTime,
    );

    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Succeeded after waiting out active cooldown",
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
    } as any);

    const orchestrator = new VercelLLMOrchestrator({
      model: mockModel,
      providerName: "openai",
      storageManager: mockStorageManager,
      sleepFn: mockSleep,
    });

    const decision = await orchestrator.generateNextTurn("session-2", [], []);

    expect(decision).toEqual({
      type: "complete",
      message: "Succeeded after waiting out active cooldown",
    });

    // Verify system fetched the cooldown and slept before executing any request
    expect(mockStorageManager.getRateLimitCooldown).toHaveBeenCalledWith(
      "openai",
    );
    expect(mockSleep).toHaveBeenCalledTimes(1);
    const sleptFor = vi.mocked(mockSleep).mock.calls[0][0];
    // Allow slight tolerance due to test execution timing
    expect(sleptFor).toBeGreaterThanOrEqual(4900);
    expect(sleptFor).toBeLessThanOrEqual(5000);
  });

  it("should default retry-after to a configurable backoff (or standard default) if header is missing or unparseable", async () => {
    // Throw standard 429 without readable retry headers
    const vague429 = new MockAPICallError("Vague rate limit", 429, null);

    vi.mocked(generateText)
      .mockRejectedValueOnce(vague429)
      .mockResolvedValueOnce({
        text: "Succeeded on retry",
        toolCalls: [],
        toolResults: [],
        finishReason: "stop",
      } as any);

    const orchestrator = new VercelLLMOrchestrator({
      model: mockModel,
      providerName: "openai",
      storageManager: mockStorageManager,
      sleepFn: mockSleep,
    });

    await orchestrator.generateNextTurn("session-3", [], []);

    // Verify it fell back to a default (e.g., 2 seconds / 2000ms)
    expect(mockSleep).toHaveBeenCalledTimes(1);
    const sleptFor = vi.mocked(mockSleep).mock.calls[0][0];
    expect(sleptFor).toBe(2000); // Expecting default backup sleep delay
  });

  it("should return a failure decision if retry attempts exceed max limits", async () => {
    const error429 = new MockAPICallError("Continuous rate limits", 429, "1");

    // Stub persistent rate limits exceeding limit
    vi.mocked(generateText).mockRejectedValue(error429);

    const orchestrator = new VercelLLMOrchestrator({
      model: mockModel,
      providerName: "openai",
      storageManager: mockStorageManager,
      sleepFn: mockSleep,
      maxRetries: 1, // Only retry once
    });

    const decision = await orchestrator.generateNextTurn("session-4", [], []);

    expect(decision).toEqual({
      type: "fail",
      message: "Continuous rate limits",
    });

    // Should run once initially + 1 retry = 2 attempts total
    expect(generateText).toHaveBeenCalledTimes(2);
  });
});
