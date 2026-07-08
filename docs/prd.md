# PRODUCT REQUIREMENTS DOCUMENT: Nexus CLI Agent

## 1. System Vision & Boundaries (Conceptual Integrity)

### Core Objective & Architecture Metaphor

The core objective of the Nexus CLI Agent is to provide a local, highly secure, and efficient terminal-based AI coding assistant. The system automates local workspace exploration, code modifications, and localized test verification within a secure, controlled shell environment.

**Architectural Metaphor:**
The system operates as an _ACID-Transactional Git-Shadowed compiler execution runner_. The local file directory is treated as a transactional filesystem ledger. **Sandbox Branching** acts as an isolated transactional ledger space, while the local SQLite database serves as the system's Write-Ahead Log (WAL), recording execution states prior to running modifications.

---

### User Journeys & CLI UX Flows

#### Journey 1: Local Session Initialization (`nexus init`)

- **User Action:** The user executes `nexus init` within a Git-tracked workspace repository.
- **Terminal Input:**
  ```bash
  $ nexus init
  ```
- **Screen States & Feedback:**
  1.  _State: Checking Environment._ An active spinner displays beside text: `[Saving Workspace Status...]`.
  2.  _State: Database Setup._ Text displays: `[Configuring local state tracking database in ~/.config/nexus/history.db...]`.
  3.  _State: Success._ Spinner stops and turns green.
- **Expected Outputs:**
  - A local SQLite database file is created at `~/.config/nexus/history.db`.
  - An `agent.config.json` template is generated in the root of the workspace directory.
  - Terminal displays: `✔ Workspace successfully initialized for Nexus CLI Agent.`

#### Journey 2: Executing an Autonomous Task (`nexus run "<prompt>"`)

- **User Action:** The user executes a task command (e.g., `nexus run "Fix auth callback redirect pattern"`).
- **Terminal Input:**
  ```bash
  $ nexus run "Fix authorization callback redirect pattern"
  ```
- **Screen States & Feedback:**
  1.  _State: Branch Isolation._ Spinner displays: `[Creating isolated Sandbox Branching workspace...]`.
  2.  _State: Execution Loop._ Displays step counters: `Step [1/15] - Agentic Loop Initiated`.
  3.  _State: Step Output._ Shows read actions bypassing approval: `🔍 Listing directory...` or `📖 Reading auth.ts (Lines 10-50)...`.
  4.  _State: Safe Command Approval._ When attempting a mutating terminal run (e.g., executing a local test runner script):
      ```text
      Nexus CLI Agent requests execution of:
      ⚡ Parameterized Safe-Command: npm run test -- src/auth.test.ts
      Do you authorize this execution? [Y/n]:
      ```
  5.  _State: State Patching._ When applying edits, the console displays: `⚙ Applying Search-and-Replace Block to src/auth.ts...`.
  6.  _State: Sandbox Resolution._ Upon task completion or encountering a **Step Limit** exhaustion:
      ```text
      ✔ Task complete. Reviewing changes...
      [Terminal renders standard Git diff visual]
      Do you approve merging these edits into your main workspace? [Y/n]:
      ```
- **Expected Outputs:**
  - An isolated Git branch named `agent/[task-uuid]` is dynamically generated.
  - Modifications are completed locally using highly granular **Search-and-Replace Blocks**.
  - If approved, the temporary branch merges into the active working directory, and the branch is deleted.

#### Journey 3: Process Interrupt Handling (`Ctrl+C`)

- **User Action:** The user issues a keyboard interrupt during active tool execution.
- **Terminal Input:**
  ```text
  [User presses Ctrl+C during Step 4 execution]
  ```
- **Screen States & Feedback:**
  1.  _State: Interruption Captured._ Terminal interrupts standard stdout with message: `⚠️ Process interrupted by user.`
  2.  _State: Local State Commit._ Text displays: `[Committing active step state transaction to local SQLite DB...]`.
  3.  _State: Cleanup Options._ Prompt displays:
      ```text
      Would you like to preserve the active Sandbox Branching workspace for manual review? [Y/n]:
      ```
- **Expected Outputs:**
  - All current step logs and output buffers are committed to the local SQLite database.
  - The terminal safely restores the initial Git branch state without discarding the user's uncommitted workspace modifications.

---

### Out of Scope

The following boundaries are established to prevent scope creep:

- **Remote Server Orchestration:** No remote execution, cloud VMs, or remote container environments. Execution is strictly local to the user's host environment.
- **Direct Unvalidated CLI Scripts:** Direct shell invocations that bypass template configurations or do not comply with the strictly defined parameters of a **Parameterized Safe-Command** are rejected.
- **De-Novo Full File Rewrites:** The LLM cannot write entirely new file payloads over existing resources. All file modifications must be structured as target patching via a **Search-and-Replace Block**.
- **Non-Git Repository Targeting:** Execution on local directories that do not contain an active Git repository initialization is strictly disallowed to prevent unrecoverable file modifications.

---

## 2. Domain Dictionary (Ubiquitous Language)

To prevent translation degradation, the exact terms defined below must be used consistently across all modules, tests, specifications, and code files.

| Term                           | Strict Domain Definition                                                                                                                                            | System Mapping                                                                     |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------- |
| **Agentic Loop**               | The autonomous, self-correcting cycle where the system evaluates user intent, invokes local tools, processes tool outputs, and determines successive actions.       | Class: `src/core/AgenticLoopStateMachine.ts`                                       |
| **Step Limit**                 | A hard limit constraint specifying the maximum allowed consecutive tool calls within a single user request to prevent runaway loops and infinite debugging cycles.  | Configuration Property: `limits.stepLimit` mapped within `AgenticLoopStateMachine` |
| **Sandbox Branching**          | An automated version-control mechanism that isolates experimental file edits and test runs on a temporary Git branch, shielding the developer's active workspace.   | Class: `src/git/SandboxBranchManager.ts`                                           |
| **Parameterized Safe-Command** | A predefined terminal execution template configured by the user that restricts execution arguments to verified paths, neutralizing shell injection vulnerabilities. | Class: `src/execution/SafeCommandExecutor.ts`                                      |
| **Search-and-Replace Block**   | A targeted patch strategy containing a contextual target block of existing code and its replacement, avoiding full-file write payloads.                             | Interface: `src/patch/types.ts::SearchReplaceBlock`                                |

---

## 3. Module Interface Contracts (Deep Modules)

Complexity must remain hidden behind clean, simple, and stable interfaces. The following definitions declare the public surfaces and isolated internals of each core module.

```
       +-------------------------------------------------------------+
       |                         CLI RUNTIME                         |
       +-------------------------------------------------------------+
              |                                            |
              v                                            v
+-----------------------------+              +-----------------------------+
|    Terminal UX Module       |              |    Agentic Loop Module      |
|                             |              |                             |
|  - Renders Clack UX         |              |  - Orchestrates execution   |
|  - Handles User Approvals   |              |  - Evaluates Step Limits    |
+-----------------------------+              +-----------------------------+
              |                                            |
              +--------------------+  +--------------------+
                                   |  |
                                   v  v
                     +-----------------------------+
                     |    LLM Orchestration        |
                     |                             |
                     |  - Vercel AI SDK wrapper    |
                     |  - Rate-limit Retries       |
                     |  - Context Pruning          |
                     +-----------------------------+
                                   |
              +--------------------+-----------------------+
              |                                            |
              v                                            v
+-----------------------------+              +-----------------------------+
|    Sandbox Execution        |              |    SQLite Storage Module    |
|                             |              |                             |
|  - Git Branch Isolation     |              |  - Transactional WAL        |
|  - Search-Replace Patching  |              |  - Rate Limit Tracker       |
|  - Safe-Command Run         |              |                             |
+-----------------------------+              +-----------------------------+
```

### Module 1: SQLite Storage Module

- **Public API (Simple Interface):**

  ```typescript
  export interface SQLiteStorageManager {
    initializeDatabase(): Promise<void>;
    saveStep(
      sessionId: string,
      stepIndex: number,
      payload: StepRecord,
    ): Promise<void>;
    getSessionHistory(sessionId: string): Promise<StepRecord[]>;
    logRateLimitCooldown(provider: string, resetEpochMs: number): Promise<void>;
    getRateLimitCooldown(provider: string): Promise<number | null>;
  }

  export interface StepRecord {
    timestamp: string;
    toolName: string;
    args: Record<string, any>;
    stdoutSummary?: string;
    tokenCountEstimate: number;
  }
  ```

- **The Hidden Internals (Complexity):**
  - Integrates `better-sqlite3` library for low-latency synchronous blocking transactions during step execution.
  - Maintains a hidden schema defining table structures for `execution_sessions`, `step_logs`, and `provider_cooldowns`.
  - Hides database file system checks, configuration path creation routines, and raw SQL queries (e.g., `INSERT INTO step_logs...`).

---

### Module 2: LLM Orchestration Module

- **Public API (Simple Interface):**

  ```typescript
  export interface LLMOrchestrator {
    generateNextTurn(
      sessionId: string,
      currentHistory: StepRecord[],
      availableTools: ToolSpec[],
    ): Promise<AgenticDecision>;
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
  ```

- **The Hidden Internals (Complexity):**
  - Imports and wraps the Vercel AI SDK core engine (`ai` and specific model integrations).
  - Evaluates response headers to catch status code `429` (Rate-Limits) and implements exponential backoff pause cycles.
  - Handles historical token evaluation: automatically matches steps older than 4 iterations and uses a private summarization system prompt to compress logs into standard summary entries.

---

### Module 3: Sandbox Execution Module

- **Public API (Simple Interface):**

  ```typescript
  export interface SandboxExecutor {
    applySandboxBranch(taskId: string): Promise<void>;
    restoreOriginalBranch(): Promise<void>;
    mergeSandboxBranch(): Promise<void>;
    applyCodePatch(filePath: string, block: SearchReplaceBlock): Promise<void>;
    executeCommand(command: ParameterizedSafeCommand): Promise<string>;
  }

  export interface SearchReplaceBlock {
    filePath: string;
    find: string;
    replace: string;
  }

  export interface ParameterizedSafeCommand {
    commandKey: string;
    argumentTarget: string;
  }
  ```

- **The Hidden Internals (Complexity):**
  - Executes raw underlying Shell interactions using Node.js `child_process.execSync` wrappers.
  - Performs Git state validations: checks if the workspace tree is dirty, manages raw Git stash allocations, and runs standard commands (`git checkout -b`, `git checkout main`, `git merge`, `git branch -D`).
  - Safeguards path parameters against command shell-injection exploits by passing target files through isolated regex path mapping checks.
  - Locates and modifies exact file matches for **Search-and-Replace Blocks** while validating block existence.

---

### Module 4: Terminal Interface Module

- **Public API (Simple Interface):**
  ```typescript
  export interface TerminalInterface {
    showSpinner(message: string): void;
    stopSpinner(success: boolean, message?: string): void;
    requestUserApproval(promptMessage: string): Promise<boolean>;
    renderDiffView(diffText: string): void;
    displayTerminalError(errorMessage: string): void;
  }
  ```
- **The Hidden Internals (Complexity):**
  - Utilizes the `@clack/prompts` library to construct clean interactive terminals and CLI prompts.
  - Uses ANSI color encoding and output styling routines.
  - Directly accesses and manipulates the standard operating system output stream (`process.stdout`).

---

## 4. Functional Specifications & TDD Verification Specs

### REQ-01: Agentic Loop Execution State Machine

- **Description:** The system must process user tasks through a sequential state machine executing an **Agentic Loop** that evaluates historical tool runs and dynamically requests the next step.
- **Verification & Test Spec (TDD):**
  - _Setup:_ Instantiates an `AgenticLoopStateMachine` class mocking the `LLMOrchestrator` interface. Configure the mock model to return a tool run request on step 1, and return a completed state representation on step 2.
  - _Execution:_ Run the state execution loop using `agenticLoop.start("Refactor login verification system")`.
  - _Assertion:_ Confirm that the mock model receives historical updates from the first step's execution result. Verify that `SQLiteStorageManager.saveStep` is executed twice, tracking the lifecycle progression.

### REQ-02: Step Limit Hard Boundary Enforcement

- **Description:** The system must terminate the **Agentic Loop** and report a failure if the execution exceeds the maximum configured **Step Limit** threshold.
- **Verification & Test Spec (TDD):**
  - _Setup:_ Set the **Step Limit** configuration parameter to 3. Configure the `LLMOrchestrator` stub to perpetually request a file view tool execution.
  - _Execution:_ Run `agenticLoop.start("Audit code base patterns")`.
  - _Assertion:_ Confirm that the execution stops after the 3rd step. Assert that the loop throws an execution error containing the phrase: `Step Limit limit of 3 reached. Terminating loop to prevent runaway behavior`.

### REQ-03: Sandbox Branching Lifecycle Isolation

- **Description:** Before any file alterations are executed, the system must trigger **Sandbox Branching**, creating a temporary Git workspace and stashing uncommitted modifications. If finalized successfully, the branch is merged; if aborted or failing, the workspace must be safely restored to its pristine pre-session Git state.
- **Verification & Test Spec (TDD):**
  - _Setup:_ Create a mock file system containing a Git repository with uncommitted changes in `index.ts`. Instantiates `SandboxBranchManager` mocking the console prompt tool.
  - _Execution:_ Call `SandboxBranchManager.applySandboxBranch("task-123")`.
  - _Assertion:_ Verify that `git stash list` contains a stash reference, and `git branch --show-current` returns `agent/task-123`.

### REQ-04: Parameterized Safe-Command Shell-Injection Validation

- **Description:** When executing configured test utilities, the system must parse the target path argument to confirm that no unvalidated shell metacharacters (e.g., `;`, `&&`, `|`, `` ` ``, `$()`) are included in the execution stream.
- **Verification & Test Spec (TDD):**
  - _Setup:_ Configure `SafeCommandExecutor` with a command template mapping: `npm run test -- {target}`.
  - _Execution:_ Attempt execution using an injection argument: `SafeCommandExecutor.execute("test-cmd", "src/auth.test.ts; rm -rf /")`.
  - _Assertion:_ Assert that the command throws a safety validation exception stating: `Invalid parameter path: shell metacharacter injection detected`. Verify that the child execution process is never spawned.

### REQ-05: Search-and-Replace Block Code Patching

- **Description:** The modification engine must ingest file references alongside a **Search-and-Replace Block**, locate the matched section in target files, execute the modification, and return a structured confirmation. If the lookup sequence fails to resolve, a descriptive error message must be raised.
- **Verification & Test Spec (TDD):**
  - _Setup:_ Write a temporary file containing:
    ```typescript
    const x = 5;
    const y = 10;
    ```
  - _Execution:_ Call `PatchExecutor.applyPatch` targeting the file with a **Search-and-Replace Block**:
    ```json
    {
      "find": "const y = 10;",
      "replace": "const y = 20;"
    }
    ```
  - _Assertion:_ Assert that the file is successfully updated to read: `const y = 20;`. Repeat the execution with a block that does not match the file's contents, and assert that it throws an exception: `Patch failed: Target match pattern not resolved in file`.

### REQ-06: Hybrid Token Summarization & History Pruning

- **Description:** To manage model context length limitations, tool outputs older than 4 execution turns must be compressed using a lightweight summarization request, discarding raw terminal and verbose file buffers from the execution memory.
- **Verification & Test Spec (TDD):**
  - _Setup:_ Populates the active execution history log tracking list with 5 detailed execution actions. Configure the mock summarization model to return: `Summary of Step`.
  - _Execution:_ Call `LLMOrchestrator.pruneContext()`.
  - _Assertion:_ Assert that the list of history details is reduced. Verify that steps 1 and 2 are replaced by a summarized record containing the string `Summary of Step`, while steps 4 and 5 maintain their raw buffers.

### REQ-07: Rate-Limit Exponential Backoff Persistence

- **Description:** When encountering an LLM rate-limit status code (`429`), the platform must catch the error, extract the provider's retry delay information, write a cooldown timestamp to the local tracking table, and schedule retries via exponential backoff increments.
- **Verification & Test Spec (TDD):**
  - _Setup:_ Configure a mock network wrapper to throw a `429` error containing a response header: `retry-after: 2`.
  - _Execution:_ Run `LLMOrchestrator.generateNextTurn(...)`.
  - _Assertion:_ Confirm that the system catches the `429` error, registers a cooldown record in the local SQLite table for 2 seconds, and waits before retrying the generation.

---

## 5. Architectural Resolutions (Open Questions Resolved)

### Issue 1: API Key Storage

- **Trade-off Analysis:**
  1.  _OS Keyring Integration:_ Highly secure, but introduces significant cross-compilation native binary vulnerabilities on developer host platforms during `npm install` (e.g., node-gyp build failures on diverse Linux shells or outdated Windows build environments).
  2.  _Standard `.env` configuration files:_ Simplistic, but insecure if configuration files are committed to public version control systems.
  3.  _User-Level Config Files with File Permission Lockdowns:_ Securely resolves compile issues while maintaining local control.
- **Recommended MVP Resolution:**
  Nexus will store credentials in a local user configuration folder (`~/.config/nexus/.env`) with access restricted to the executing system user (file mode `0600`).
- **Architectural Justification:**
  This solution eliminates native integration compile risks across systems, keeps configurations out of the active Git repository workspace, and leverages standard Unix file-system isolation blocks.

---

### Issue 2: CLI UI Paradigm

- **Trade-off Analysis:**
  1.  _Rich, Dynamic Dashboard Interface (React-based Ink):_ Visually striking dashboard panels. However, it imposes heavy runtime complexity, frequently introduces interface rendering issues on various Windows terminal implementations, and consumes considerable CPU overhead during large terminal stdout streaming blocks.
  2.  _Sequential Interactive Terminal Layouts (Clack):_ Simple, predictable console footprints that execute reliably across standard terminal emulators.
- **Recommended MVP Resolution:**
  Use `@clack/prompts` to generate structured, sequential command outputs with standard interactive loaders and verification inputs.
- **Architectural Justification:**
  Minimizes terminal presentation bugs, keeps the rendering layer simple, and runs predictably in constrained server or remote SSH environments without sacrificing interactivity.

---

### Issue 3: Multi-Language AST/Compiler Error Interpretation

- **Trade-off Analysis:**
  1.  _Custom Built-In AST Parsers:_ Extremely precise compilation tracing. However, this is exceptionally complex to build, scales poorly across diverse languages, and requires maintaining massive parser engine layers for each compiler version.
  2.  _Standardized Runtime Error Wrapping:_ Captures command stdout/stderr logs and passes formatted execution errors straight to the model.
- **Recommended MVP Resolution:**
  Create a standardized error capture wrapper that intercepts non-zero exit codes from terminal test executions and passes the compiler's raw stdout/stderr output directly to the next step of the **Agentic Loop**, wrapped in standard XML structure tags:
  ```xml
  <compiler_error>
  [Raw captured stderr/stdout outputs here]
  </compiler_error>
  ```
- **Architectural Justification:**
  Delegating language error analysis directly to the LLM keeps the CLI engine simple, modular, and language-agnostic while ensuring the system can process error footprints from any modern compiler out of the box.
