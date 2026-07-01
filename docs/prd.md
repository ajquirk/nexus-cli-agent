# PRODUCT REQUIREMENTS DOCUMENT: Nexus CLI Coding Agent

## 1. System Vision & Boundaries (Conceptual Integrity)

### Core Objective & Architecture Metaphor

The core objective of the Nexus CLI Coding Agent is to provide software engineers with an autonomous, workspace-aware assistant that operates locally. It securely traverses codebase files, runs validation command pipelines, and coordinates with external Large Language Model (LLM) providers through an interactive command-line interface.

**Architectural Metaphor:**
_The Nexus CLI Coding Agent operates as an autonomous, conversational terminal session coordinator that treats the local project directory as a version-controlled database. The Agentic Loop processes state mutations exclusively behind an audited, transactional confirmation barrier, ensuring no destructive action is taken without explicit human consent._

### User Journeys & CLI UX Flows

#### Journey 1: Agent Initialization & Workspace Booting

1. **User Action:** The user executes `nexus` (or `nexus --continue` to restore the last active state).
2. **Terminal State:** The screen clears. A localized CLI banner is rendered using `picocolors`.
3. **Execution State:** An `ora` spinner displays: `[spinning] Compiling environment snapshot...`
4. **Behavior:** The system checks `~/.my-agent/config.json` for validation and reads the active workspace. It detects any localized `.agentrules` file.
5. **Output State:**
   - A clean workspace overview is printed showing:
     - Workspace Root Path
     - Detected Configured Model (e.g., Claude 3.5 Sonnet)
     - Loaded Rules count
     - Active Conversation status (New or Resumed)
   - The terminal transitions to a prompt input line: `Nexus > `

#### Journey 2: Conversational Prompt & Agentic Loop Execution

1. **User Action:** The user enters a task: `Nexus > Implement standard response wrapping on the Express router.`
2. **Terminal State:** An `ora` spinner starts: `[spinning] Nexus is thinking...`
3. **Behavior:** The system assembles the `Environment Snapshot` and sends the context payload to the configured LLM.
4. **Agentic Loop Step 1 (Safe Tool Execution):**
   - The LLM decides to search for the route files. It invokes `search_code`.
   - The terminal displays an active state line: `[Safe Tool] Executing search_code for "router"...` (no user authorization is requested, as this is a read-only action).
   - The search results are returned and piped back to the LLM context.
5. **Agentic Loop Step 2 (Action Tool Execution & Authorization Prompt):**
   - The LLM generates a code file modification and attempts to invoke `write_file` on `src/routes/user.ts`.
   - The Agentic Loop pauses immediately.
   - A `@clack/prompts` confirmation module takes focus:
     ```bash
     ? Nexus requests permission to modify src/routes/user.ts.
       Do you want to apply these changes?
       > Yes, execute tool.
         No, deny and interrupt.
         View proposed changes.
     ```
   - **If authorized:** The tool executes, outputs confirmation text, and resumes the Agentic Loop.
   - **If denied:** The loop is paused, a cancel context is sent back to the LLM, and control is returned safely to the user via the `Nexus > ` prompt.

#### Journey 3: Runaway Loop Interruption

1. **User Action:** During a long-running execution of `run_command` (e.g., running tests) or a massive LLM streaming response, the user presses `Ctrl+C`.
2. **Terminal State:**
   - **First Interrupt (Single Tap):** The running subprocess or the stream is forcefully closed. The current chat state up to that point is compiled and persisted to the local SQLite database. The terminal displays a warnings notice: `[Interrupt] Operation cancelled by user. State saved. Resetting...`
   - The CLI displays the prompt input line: `Nexus > `
   - **Second Interrupt (Double-Tap within 1000ms):** The CLI terminates safely and returns the shell back to the standard terminal environment, cleanly closing all open process streams.

### Out of Scope

- **Multi-User Collaboration & Authentication:** The application is strictly a single-user local CLI utility. No remote database management, team workspaces, or user login systems will be implemented.
- **Native Desktop Interface (GUI):** No Electron wrapper, web interface, or native OS window will be developed in this lifecycle. The system is strictly a shell/terminal application.
- **Direct Remote Host Execution:** The tool does not support direct execution of tools across SSH or within remote containerized machines unless initiated directly via a localized shell path.

---

## 2. Domain Dictionary (Ubiquitous Language)

| Domain Term                 | Strict Definition                                                                                                                                    | System Mapping                                                                                        |
| :-------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| **Agentic Loop**            | The continuous state machine cycle of LLM inference, structured tool selection, tool execution, and execution output parsing.                        | Interface `IAgenticLoopEngine` and class `AgenticLoopController`.                                     |
| **Safe Tools**              | Non-destructive, read-only system tools executed autonomously by the agent without prompting the user for verification.                              | Abstract class `BaseSafeTool` implementing interface `ITool`.                                         |
| **Action Tools**            | Destructive, mutating, or code-executing operations that pose safety risks and require explicit human authorization to run.                          | Abstract class `BaseActionTool` implementing interface `ITool` and bound to the confirmation barrier. |
| **Environment Snapshot**    | A compiled, structured textual dataset describing the host OS, current directory path, active shell context, and top-level directory file structure. | TypeScript Type `EnvironmentSnapshot` output by the `WorkspaceContextManager` class.                  |
| **Project-Specific Rules**  | Workspace-specific guidelines, testing protocols, and style guidelines loaded from a local `.agentrules` file at runtime.                            | Class `ConfigManager` and its internal property `projectRules`.                                       |
| **Double-Tap Interruption** | A mechanism using a time-sensitive dual-Ctrl+C handler to safely abort tasks on the first interrupt, or terminate the program on the second.         | Class `InterruptHandler` acting directly on the system `process` signal listeners.                    |
| **Conversation**            | A unique, persistent chronological series of interlinked user prompts, system responses, and tool executions.                                        | Database table `conversations` mapped via Class `SessionStore`.                                       |
| **Message**                 | An individual atomic textual entry or tool interaction metadata payload belonging to a parent Conversation.                                          | Database table `messages` mapped via Class `SessionStore`.                                            |

---

## 3. Module Interface Contracts (Deep Modules)

```
                       +-------------------------------------------------+
                       |             CLI Entrypoint (index.ts)           |
                       +------------------------+------------------------+
                                                |
                                                v
                       +-------------------------------------------------+
                       |            AgenticLoopController               |
                       +--------+---------------+---------------+--------+
                                |               |               |
                                v               v               v
  +-------------------------------+   +---------------------------+   +---------------------------+
  |        TerminalRenderer       |   |       SessionStore        |   |       ConfigManager       |
  |  - Prompts, Spinners, Colors  |   |  - conversations table    |   |  - config.json, .agentrules|
  |  - Execution Pause Barriers  |   |  - messages table         |   |  - EnvironmentSnapshot    |
  +-------------------------------+   +---------------------------+   +---------------------------+
                                                |
                                                v
                               +----------------------------------+
                               |           ToolRegistry           |
                               |  - Safe Tools / Action Tools     |
                               |  - Process Spawning & Limits     |
                               +----------------------------------+
```

### 3.1 Orchestration Module (`AgenticLoopController`)

Responsible for managing the execution lifecycle of the **Agentic Loop**, handling state transitions, streaming context payloads to the Vercel AI SDK, and coordinating tool selection.

- **Public API:**
  ```typescript
  export interface IAgenticLoopEngine {
    initializeSession(options: {
      continueLast?: boolean;
      modelOverride?: string;
    }): Promise<string>;
    executeCycle(userPrompt: string): Promise<void>;
    registerInterrupt(): void;
  }
  ```
- **Hidden Internals (Complexity):**
  - Configuration of the `@ai-sdk/core` client engine.
  - Direct state tracking of the active conversation thread.
  - System prompt assembly combining the static configuration, active **Environment Snapshot**, and **Project-Specific Rules**.
  - Model rate limit parsing, automatic back-off strategies, and parsing parameters for Anthropic, OpenAI, and Google Gemini.

### 3.2 Tool Execution Module (`ToolRegistry`)

Coordinates execution paths for **Safe Tools** and **Action Tools**. Encapsulates terminal isolation boundaries, path resolution restrictions, and execution safeguards.

- **Public API:**

  ```typescript
  export interface ToolExecutionResult {
    output: string;
    isError: boolean;
    wasTruncated: boolean;
  }

  export interface IToolRegistry {
    executeTool(
      toolName: string,
      argumentsPayload: Record<string, any>,
    ): Promise<ToolExecutionResult>;
    isActionTool(toolName: string): boolean;
  }
  ```

- **Hidden Internals (Complexity):**
  - Spawning child execution shells using the Node.js native `child_process.spawn` library.
  - Absolute path enforcement algorithms checking path arguments against active directory boundaries to prevent root escapes.
  - Text truncation filter logic: truncates output streams exceeding 3,000 characters by extracting the first 50 lines and last 50 lines and introducing the textual delimiter `[...Output truncated...]`.
  - Tracking of running child process PIDs to handle emergency terminations.

### 3.3 Persistence & Session Module (`SessionStore`)

Manages historical persistence of state, conversation trees, configuration values, and logs. Runs completely synchronously for local speed optimization using `better-sqlite3`.

- **Public API:**

  ```typescript
  export interface IDatabaseConversation {
    id: string;
    title: string;
    createdAt: number;
  }

  export interface IDatabaseMessage {
    id: string;
    conversationId: string;
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    timestamp: number;
  }

  export interface ISessionStore {
    getLatestConversation(): IDatabaseConversation | null;
    getAllConversations(): IDatabaseConversation[];
    getConversationMessages(conversationId: string): IDatabaseMessage[];
    saveMessage(message: Omit<IDatabaseMessage, "id" | "timestamp">): void;
    createNewConversation(title: string): string;
  }
  ```

- **Hidden Internals (Complexity):**
  - Direct bindings to the `better-sqlite3` driver.
  - Automated migration steps to construct `conversations` and `messages` tables inside `~/.my-agent/chats.db` if not found during startup.
  - Synchronization mechanics to lock physical file writes during intense disk tasks.

### 3.4 User Interface Module (`TerminalRenderer`)

Abstracts visual design details from operational program mechanics. Employs `readline`, `picocolors`, and `@clack/prompts`.

- **Public API:**
  ```typescript
  export interface ITerminalRenderer {
    startSpinner(label: string): void;
    stopSpinner(label: string, success: boolean): void;
    renderSystemMessage(message: string): void;
    renderAssistantOutput(streamChunk: string): void;
    promptUserConfirmation(promptText: string): Promise<boolean>;
    promptUserSelect<T>(
      title: string,
      options: { value: T; label: string }[],
    ): Promise<T>;
    promptUserInput(promptText: string): Promise<string>;
  }
  ```
- **Hidden Internals (Complexity):**
  - Raw input configurations to map characters and intercept specific terminal keystrokes.
  - `readline` screen clear operations, column formatting calculations, and terminal color rendering.
  - Custom dynamic layouts constructed via `@clack/prompts` to ask for verification before executing **Action Tools**.

### 3.5 Context & Configuration Module (`ConfigManager`)

Compiles environment variables, structures localized workspace context, and reads persistent global settings.

- **Public API:**

  ```typescript
  export interface IAppConfig {
    defaultModelProvider: string;
    apiKey: string;
  }

  export interface IConfigManager {
    getConfig(): IAppConfig;
    updateConfigKey(key: string, value: string): void;
    getEnvironmentSnapshot(): EnvironmentSnapshot;
    getProjectSpecificRules(): string | null;
  }
  ```

- **Hidden Internals (Complexity):**
  - Reading and writing actions against `~/.my-agent/config.json`.
  - Dynamic retrieval of environment metrics (Process OS platforms, shell contexts, path resolution details).
  - Direct file listing and directory exclusions (filtering out `.git` and `node_modules` subdirectories).

---

## 4. Functional Specifications & TDD Verification Specs

### REQ-01: Local Session Recovery Mechanics

- **Description:** The application must parse arguments at startup. If the `--continue` or `-c` flag is present, it must immediately retrieve the most recent active session from the SQLite store and bypass interactive menu checks. If the `resume` subcommand is passed, it must present an interactive menu of past conversations compiled from the database.
- **Verification & Test Spec:**
  - _Setup:_ Seed the SQLite database with three distinct historical conversations. Set a mock argument parser payload mimicking `-c` configuration.
  - _Execution:_ Initialize `AgenticLoopController.initializeSession({ continueLast: true })`.
  - _Assertion:_ Assert that the returned conversation ID matches the record with the most recent timestamp in the database. When called with `continueLast: false`, assert that the system invokes `TerminalRenderer.promptUserSelect` showing the list of seeded conversations.

### REQ-02: Project-Specific Rules Ingestion

- **Description:** During workspace bootup, the application must detect a `.agentrules` file inside the initialization directory. If present, it must load the rules and append them to the active prompt context alongside the **Environment Snapshot** context.
- **Verification & Test Spec:**
  - _Setup:_ Create a mock local file directory. Construct a `.agentrules` file containing the string `"Ensure all tests run using Vitest"`. Mock `ConfigManager` configuration targets to parse this temporary path.
  - _Execution:_ Execute `ConfigManager.getProjectSpecificRules()`.
  - _Assertion:_ Assert that the output string matches the file contents exactly. Assert that when the file is absent, `ConfigManager.getProjectSpecificRules()` returns `null` without throwing an error.

### REQ-03: Environment Snapshot Architecture Setup

- **Description:** The application must compile workspace details into an injection-safe system prompt. This payload must include the absolute host path, active OS type, active terminal shell string, and a top-level workspace directory structure listing that excludes `.git` and `node_modules`.
- **Verification & Test Spec:**
  - _Setup:_ Create a mock workspace directory containing directories: `.git/`, `node_modules/`, `src/`, and `package.json`.
  - _Execution:_ Run `ConfigManager.getEnvironmentSnapshot()`.
  - _Assertion:_ Assert that the returned directory file list output contains `src/` and `package.json`. Assert that it contains no entries containing `.git` or `node_modules`.

### REQ-04: Tool Output Safe Truncation Filter

- **Description:** Any output returned by a tool (e.g., shell commands or file reads) that exceeds 3,000 characters must be truncated. The output must retain the first 50 lines and last 50 lines of execution logs or file contents, separated by the warning string `[...Output truncated...]`.
- **Verification & Test Spec:**
  - _Setup:_ Generate a text stream of 200 lines, where each line contains exactly 40 characters (8,000 characters total).
  - _Execution:_ Pass this output payload to the internal truncation formatting function of the `ToolRegistry`.
  - _Assertion:_ Assert that the returned output length is less than 8,000 characters, containing exactly 101 lines: the first 50 input lines, followed by the literal string `[...Output truncated...]`, followed by the last 50 input lines.

### REQ-05: Double-Tap Interruption Mechanics

- **Description:** System must capture `SIGINT`. A single `Ctrl+C` interrupt within the system must immediately abort active subprocesses or LLM context generation, save current operational structures to SQLite, and revert back to standard prompt inputs. A second `Ctrl+C` input received within 1,000 milliseconds of the first must exit the Node process safely.
- **Verification & Test Spec:**
  - _Setup:_ Register a spy on `process.exit`. Instantiate `InterruptHandler` listening to `SIGINT`.
  - _Execution:_ Programmatically emit a single `SIGINT` signal event. Wait 200 milliseconds and programmatically emit a second `SIGINT` signal event.
  - _Assertion:_ Verify that on the first signal, `process.exit` is not called, and the system calls the internal abort handler of `AgenticLoopController`. Verify that on the second signal, `process.exit` is called with exit code `0`.

### REQ-06: Interactive Consent Barrier for Action Tools

- **Description:** Any invocation of an **Action Tool** must suspend the **Agentic Loop** and require explicit human confirmation. Invoking a **Safe Tool** must execute autonomously without requesting user verification.
- **Verification & Test Spec:**
  - _Setup:_ Spy on `TerminalRenderer.promptUserConfirmation` to return `true` on mock queries. Mock an LLM tool request call.
  - _Execution Step A:_ Invoke a **Safe Tool** (e.g., `list_directory`).
  - _Assertion Step A:_ Assert that the tool executes immediately, and the `promptUserConfirmation` spy is not called.
  - _Execution Step B:_ Invoke an **Action Tool** (e.g., `write_file`).
  - _Assertion Step B:_ Assert that the tool execution is deferred until `promptUserConfirmation` is invoked and returns `true`.

---

## 5. Architectural Resolutions (Open Questions Resolved)

### 5.1 File Patching Mechanics

```
                       +----------------------------------+
                       |           write_file             |
                       |  - Replaces whole file contents  |
                       +----------------+-----------------+
                                        |
                 Is target file larger than threshold? (e.g., 50KB)
                                        |
                         +--------------+--------------+
                         |                             |
                        YES                            NO
                         |                             |
                         v                             v
       +----------------------------------+   +----------------------------------+
       |           patch_file             |   |       Standard write_file        |
       |  - Applies exact search/replace  |   |  - Simple, robust rewrite        |
       |  - Conserves token context       |   +----------------------------------+
       +----------------------------------+
```

#### Trade-off Analysis

- **Option A (Complete Overwrite):** Simple to parse and execute. However, as file size grows, rewriting complete files causes significant token usage, latency, and susceptibility to API stream interruption.
- **Option B (Line-by-Line Patching Parser):** Extremely fast, token-efficient, and maps directly to large codebases. However, LLM generation can occasionally produce incorrect line markers or invalid regular expressions, which can corrupt files if executed without proper validation.

#### Recommended MVP Resolution

Implement a hybrid approach with two distinct tool strategies:

1. Retain `write_file` for creating new files or replacing small files (under 50KB).
2. Introduce a new tool, `patch_file`, for larger files. The `patch_file` tool takes a file path and an array of patch operations, where each operation specifies a block of lines to search for and replace:
   ```typescript
   export interface PatchBlock {
     find: string;
     replace: string;
   }
   ```
   If the search block matches uniquely within the target file, the modification is applied. Otherwise, the tool fails and prompts the LLM to refine its input parameters.

#### Architectural Justification

This hybrid approach balances simplicity and token efficiency [3]. It allows the LLM to modify complex, multi-thousand-line files by transmitting small, targeted patch blocks instead of rewriting entire files. This minimizes API costs, reduces latency, and decreases parsing failures.

---

### 5.2 Shell Command Execution Limits

#### Trade-off Analysis

- **Option A (No constraints):** Simple to build, but runs the risk of freezing the CLI indefinitely if a developer accidentally starts a long-running process (like `npm run dev`) or runs an interactive command that prompts for input.
- **Option B (Strict short-interval timeout - e.g., 10 seconds):** Keeps the interface highly responsive and prevents hanging processes. However, it blocks common developer actions like long-running database migrations, complex compilation pipelines, or comprehensive test suites.

#### Recommended MVP Resolution

Implement a default command timeout of **120 seconds** for all execution instances of `run_command` [3]. The child execution container will run in a non-interactive shell environment. Any standard input requested by a subprocess will trigger an error, sending a "Failed execution: interactive prompts are not supported" error state back into the **Agentic Loop** context.

```typescript
// Subprocess execution settings inside ToolRegistry
const child = spawn(command, {
  shell: true,
  timeout: 120000, // 120 seconds timeout limit
  env: { ...process.env, CI: "true" }, // Force continuous integration flags to suppress interactive prompt logic
});
```

#### Architectural Justification

Setting a 120-second timeout allows the tool to run complete test suites and compilation steps while preventing orphaned background processes. Passing continuous integration environment variables (e.g., `CI=true`) naturally signals frameworks to run in non-interactive modes, preventing hung execution states.

---

### 5.3 Path Resolution Policy

#### Trade-off Analysis

- **Option A (Allow absolute system paths):** Offers flexibility, allowing the agent to view files anywhere on the system (e.g., referencing system configurations in `/etc/`). However, it introduces significant security risks and makes sandbox testing much harder.
- **Option B (Enforce workspace-relative paths):** Restricts path operations to the initialized workspace directory. While this prevents the agent from reading or writing configuration files outside the target directory, it provides robust security sandboxing.

#### Recommended MVP Resolution

All path arguments accepted by safe and action tools (such as `read_file`, `write_file`, `patch_file`, `search_code`, and `list_directory`) must be resolved relative to the current working directory initialized at startup [3].

The system will use a validation utility to check paths before any execution:

```typescript
import { resolve, relative } from "path";

export function validateSecurePath(
  basePath: string,
  targetPath: string,
): string {
  const resolvedTarget = resolve(basePath, targetPath);
  const relativePath = relative(basePath, resolvedTarget);

  const isOutsideBase =
    relativePath.startsWith("..") ||
    resolve(resolvedTarget) === resolve(basePath);
  if (isOutsideBase) {
    throw new Error(
      `Access Denied: Path ${targetPath} resolved outside workspace root.`,
    );
  }
  return resolvedTarget;
}
```

#### Architectural Justification

Restricting operations to workspace-relative paths provides robust defense-in-depth security. It protects sensitive system directories (such as SSH keys or system variables) from accidental or malicious modification by the **Agentic Loop**, keeping all operations isolated to the workspace root.
