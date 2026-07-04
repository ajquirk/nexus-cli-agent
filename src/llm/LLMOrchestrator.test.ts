import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  VercelLLMOrchestrator,
  StepRecord,
  ToolSpec,
} from "./LLMOrchestrator.js";
import { generateText, LanguageModel } from "ai";

// Mock the Vercel AI SDK core function
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

describe("VercelLLMOrchestrator", () => {
  // Create a minimal mock LanguageModel object to satisfy TS interface requirements
  const mockModel = {} as unknown as LanguageModel;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return a tool_call decision when the LLM generates a tool execution payload", async () => {
    // 1. Arrange: Setup the generateText mock to simulate a tool call using correct 'input' property
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

    // 2. Act
    const decision = await orchestrator.generateNextTurn(
      "session-1",
      [],
      availableTools,
    );

    // 3. Assert
    expect(decision).toEqual({
      type: "tool_call",
      toolCall: {
        id: "123",
        name: "read_file",
        args: { filePath: "src/config/ConfigManager.ts" },
      },
    });

    // Assert generateText was invoked with the tools mapped correctly
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mockModel,
        tools: expect.objectContaining({
          read_file: expect.objectContaining({
            description: "Read local files safely",
          }),
        }),
      }),
    );
  });

  it("should return a complete decision when the LLM returns plain text with no tool calls", async () => {
    // 1. Arrange
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Task is successfully complete.",
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
    } as any);

    const orchestrator = new VercelLLMOrchestrator({ model: mockModel });

    // 2. Act
    const decision = await orchestrator.generateNextTurn("session-1", [], []);

    // 3. Assert
    expect(decision).toEqual({
      type: "complete",
      message: "Task is successfully complete.",
    });
  });

  it("should transform StepRecord history into standard Vercel AI SDK chat messages schema", async () => {
    // 1. Arrange: Setup history with an executed tool call and its stdout
    const history: StepRecord[] = [
      {
        timestamp: new Date().toISOString(),
        toolName: "read_file",
        args: { filePath: "src/config/ConfigManager.ts" },
        stdoutSummary: "file content: export class ConfigManager...",
        tokenCountEstimate: 120,
      },
    ];

    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Processing complete.",
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
    } as any);

    const orchestrator = new VercelLLMOrchestrator({
      model: mockModel,
      systemInstruction: "Custom instructions here",
    });

    // 2. Act
    await orchestrator.generateNextTurn("session-1", history, []);

    // 3. Assert messages formatting (CoreMessages still use args/result inside message parts)
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "Custom instructions here",
        messages: [
          // Assistant execution of the tool call in step history
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call_session-1_0",
                toolName: "read_file",
                args: { filePath: "src/config/ConfigManager.ts" },
              },
            ],
          },
          // Corresponding tool output returned from step history
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call_session-1_0",
                toolName: "read_file",
                result: "file content: export class ConfigManager...",
              },
            ],
          },
        ],
      }),
    );
  });

  it("should return a fail decision when the AI SDK invocation throws an unexpected error", async () => {
    // 1. Arrange: Throw network error
    vi.mocked(generateText).mockRejectedValueOnce(
      new Error("API rate-limit exceeded"),
    );

    const orchestrator = new VercelLLMOrchestrator({ model: mockModel });

    // 2. Act
    const decision = await orchestrator.generateNextTurn("session-1", [], []);

    // 3. Assert
    expect(decision).toEqual({
      type: "fail",
      message: "API rate-limit exceeded",
    });
  });

  it("should return a fail decision when the AI SDK response is empty and does not signal finish", async () => {
    // 1. Arrange: Empty response values
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "",
      toolCalls: [],
      toolResults: [],
    } as any);

    const orchestrator = new VercelLLMOrchestrator({ model: mockModel });

    // 2. Act
    const decision = await orchestrator.generateNextTurn("session-1", [], []);

    // 3. Assert
    expect(decision).toEqual({
      type: "fail",
      message:
        "No content or tool execution instructions generated by the model.",
    });
  });
});
