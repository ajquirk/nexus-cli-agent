# Role & Objective

You are acting as a rigorous, world-class Senior Software Engineer and Technical Architect. Your objective is to help me implement a single software development task following strict Test-Driven Development (TDD) principles, clean module boundaries, and the specific design constraints outlined in the provided Product Requirements Document (PRD).

We must complete this task using a strict, step-by-step interactive workflow. Do not attempt to skip any phases or generate code out of sequence.

---

## Technical Architecture & Constraints

- **Language:** TypeScript
- **Runtime:** Node.js
- **Module System:** ES Modules (ESM) (configured via `"type": "module"` in `package.json` and `"module": "NodeNext"`, `"moduleResolution": "NodeNext"` in `tsconfig.json`)
- **Testing Framework:** Vitest
- **Directory Structure:** Co-located source and test files inside `src/`. For example:
  - Implementation: `src/module/ModuleName.ts`
  - Tests: `src/module/ModuleName.test.ts`

### Architectural & Mocking Rules

1. **Deep Modules:** Hide complex functionality behind simple, clean interfaces. Do not expose internal details or raw system helpers unless explicitly part of the defined public API in Section 3 of the PRD.
2. **Testable Design (Dependency Injection):** Any class or function that interacts with system side-effects (filesystem, databases, environment variables, child processes) must allow paths or dependencies to be injected (e.g., via constructors, parameters, or option objects) so they can be isolated during testing.
3. **Environment Isolation:** Do not write to, modify, or rely on actual user configurations or local development system states during testing. Use Vitest mocks (`vi.mock()`), temporary test directories, or in-memory database instances (`:memory:`).

### Current Workspace File Structure

The existing files and directories in my project are laid out as follows:

<CURRENT_FILE_STRUCTURE>
nexus
├── .gitignore
├── docs
├── package-lock.json
├── package.json
├── prompts
├── src
│ ├── cli.test.ts
│ ├── cli.ts
│ ├── config
│ │ ├── ConfigManager.test.ts
│ │ └── ConfigManager.ts
│ ├── core
│ │ ├── AgenticLoopStateMachine.test.ts
│ │ └── AgenticLoopStateMachine.ts
│ ├── execution
│ │ ├── SafeCommandExecutor.test.ts
│ │ ├── SafeCommandExecutor.ts
│ │ ├── SafeCommandValidator.test.ts
│ │ └── SafeCommandValidator.ts
│ ├── git
│ │ ├── GitValidator.test.ts
│ │ ├── GitValidator.ts
│ │ ├── SandboxBranchManager.test.ts
│ │ └── SandboxBranchManager.ts
│ ├── llm
│ │ ├── LLMOrchestrator.test.ts
│ │ └── LLMOrchestrator.ts
│ ├── patch
│ │ ├── PatchExecutor.test.ts
│ │ └── PatchExecutor.ts
│ ├── storage
│ │ ├── SQLiteStorageManager.test.ts
│ │ └── SQLiteStorageManager.ts
│ └── terminal
│ ├── TerminalInterface.test.ts
│ └── TerminalInterface.ts
└── tsconfig.json
</CURRENT_FILE_STRUCTURE>

---

## REFERENCE: Product Requirements Document (PRD)

The system we are building is defined by the following specifications:

<PRODUCT_REQUIREMENTS_DOCUMENT>

# PRODUCT REQUIREMENTS DOCUMENT: Nexus Autonomous Coding Agent (`nexus`)

## 1. System Vision & Boundaries (Conceptual Integrity)

### Core Objective & Architecture Metaphor

The core objective of `nexus` is to establish an autonomous, CLI-based coding artificial intelligence agent capable of modifying, testing, and verifying local codebases securely and with high reliability.

The architectural metaphor for `nexus` is **"A Transactional Database Session Controller for Git."** Under this metaphor, the local file system represents the primary database. The workspace operations represent isolated transactions. Any modification to the codebase is checked out, executed, and evaluated in a structured, transient session branch. Just as database transactions are committed or rolled back based on validation, workspace operations within the **Sandbox Environment** are merged or abandoned based on the outcome of a **Parameterized Safe Command** test suite, leaving the developer's original workspace completely clean and stable.

### User Journeys & CLI UX Flows

#### Journey 1: Agent Initialization (Booting the agent)

- **Terminal Input:** User runs `nexus init` or `nexus run "fix connection timeout in db.ts"`.
- **Screen States & Terminal Outputs:**
  1.  `[nexus] Initializing local configuration directory...`
  2.  `[nexus] Checking directory permissions (0o700 isolation test)... [OK]`
  3.  `[nexus] Verifying local Git repository and workspace stability... [OK]`
  4.  `[nexus] Nexus Agent is ready.`

#### Journey 2: Task Execution (Executing a prompt and running the Agentic Loop)

- **Terminal Input:** `nexus run "Implement unique constraint on email in User model"`
- **Screen States & Terminal Outputs:**
  1.  `[nexus] Task: "Implement unique constraint on email in User model"`
  2.  `[nexus] Establishing Sandbox Environment (Session ID: task_abc123)...`
  3.  `[nexus] Checked out branch 'agent/task_abc123' and stashed untracked workspace changes.`
  4.  `[nexus] Running Agentic Loop...`
  5.  `⠋ [nexus] Step 1: Model analyzing context...` (Spinner)
  6.  `[nexus] Action: Applying Search-Replace Block (Patch) to src/models/User.ts`
  7.  `[nexus] Action: Executing Parameterized Safe Command (npm run test -- src/models/User.ts)`
  8.  `[nexus] Test Execution Successful. Continuing loop...`
  9.  `⠋ [nexus] Step 2: Evaluating execution outcomes...` (Spinner)
  10. `[nexus] Agentic Loop Terminated: STATUS = COMPLETE.`
  11. `[nexus] Action: Merging Sandbox Environment changes back to original branch...`
  12. `[nexus] Done. Workspace clean.`

#### Journey 3: Process Interrupt or Error Handling

- **Terminal Input:** User hits `Ctrl+C` (SIGINT) during active tool execution.
- **Screen States & Terminal Outputs:**
  1.  `^C`
  2.  `[nexus] Interrupt detected! Halting Agentic Loop...`
  3.  `[nexus] Reverting local modifications to Sandbox Environment...`
  4.  `[nexus] Restoring original Git branch from stash...`
  5.  `[nexus] Cleaned workspace successfully. Exiting nexus safely.`

### Out of Scope

- **Multi-User Shared Environments:** `nexus` is strictly designed for local developer terminals; it does not support remote collaborative workspaces or multiple simultaneous agents running on the same working directory.
- **Arbitrary Terminal Shell Access:** Allowing the agent to execute raw strings in terminal shells is strictly blocked. Only configured commands matching defined secure schemas can be executed.
- **Native File Creation / File Deletions (Directly via Agent):** Modifying file lifecycles (e.g., deleting files, directory structures) is out of scope for the current patch toolset. All modifications are constrained to surgical file patches via line-by-line searches.

---

## 2. Domain Dictionary (Ubiquitous Language)

| Domain Term                             | Strict Definition                                                                                                                                                                                                                      | System Mapping (Technical Entity)                           |
| :-------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------- |
| **Agentic Loop** [1, 2]                 | The autonomous state-machine execution cycle managed by `AgenticLoopStateMachine` that alternates between state evaluation, context updates, and tool-execution until reaching a terminal execution status (`complete` or `fail`) [1]. | `AgenticLoopStateMachine` class                             |
| **Sandbox Environment** [1, 2]          | An isolated workspace state established by stashing existing untracked developer modifications and checking out a session-specific Git branch (`agent/[session_id]`) to prevent permanent local workspace corruption [1].              | `SandboxBranchManager` class                                |
| **Search-Replace Block (Patch)** [1, 2] | A targeted contextual code-modification structure containing `filePath`, `find`, and `replace` strings used to perform surgical file updates without full-file rewrite [1].                                                            | `PatchExecutor` class and `SearchReplacePatch` type         |
| **Parameterized Safe Command** [1, 2]   | A predefined, pre-approved development script template (e.g., test suites, compiler checks) where target files are safely passed into designated placeholders [1].                                                                     | `SafeCommandExecutor` class and `CommandTemplate` interface |
| **Context Pruning** [1, 2]              | The process of compressing oldest execution log entries in the chat history into a singular cohesive summary text to manage context window limits and control API token consumption [1].                                               | `LLMOrchestrator.pruneContext()` method                     |

---

## 3. Module Interface Contracts (Deep Modules)

### Module 1: `ConfigManager`

- **The Public API (Simple Interface):**
  ```typescript
  interface ConfigManager {
    initializeConfig(): Promise<void>;
    getCommandTemplate(key: string): Promise<string[]>;
    getConfigDirectoryPath(): string;
  }
  ```

````

- **The Hidden Internals (Complexity):**
  - Filesystem configuration handling for POSIX systems (verifying permission masks with `fs.stat` and applying `0o700` recursively to `~/.config/nexus/`) [2].
  - Validation checks to block config parsing errors under non-POSIX runtime environments (e.g., fallback behaviors for Windows where standard POSIX permission flags are ignored).
  - Parsing and reading local configurations from `agent.config.json` [2].

### Module 2: `SandboxBranchManager`

- **The Public API (Simple Interface):**
  ```typescript
  interface SandboxBranchManager {
    applySandboxBranch(taskId: string): Promise<void>;
    restoreOriginalBranch(taskId: string): Promise<void>;
    mergeSandboxBranch(taskId: string): Promise<void>;
  }
  ```
- **The Hidden Internals (Complexity):**
  - Determining the active git workspace state (using direct child-process execution of git queries).
  - Executing safety checks such as `git stash save` to safeguard active user unstaged data before checking out session-specific branches `agent/[taskId]`.
  - Reverting merge conflicts, tracking branch references to restore state upon execution exit, and restoring user stash sets cleanly.

### Module 3: `PatchExecutor`

- **The Public API (Simple Interface):**

  ```typescript
  interface PatchExecutor {
    applyPatch(patch: SearchReplacePatch): Promise<void>;
  }

  interface SearchReplacePatch {
    filePath: string;
    find: string;
    replace: string;
  }
  ```

- **The Hidden Internals (Complexity):**
  - Reading file buffers with UTF-8 encoding.
  - Parsing multi-line sequences to enforce unique line-aligned matching [2].
  - Evaluating overall counts of find matches; specifically checking whether the search block occurs more than once within the target file.
  - Instantiating and throwing an `AmbiguousPatchError` when the search query returns multiple occurrences [2].

### Module 4: `SafeCommandExecutor`

- **The Public API (Simple Interface):**

  ```typescript
  interface SafeCommandExecutor {
    executeCommand(
      templateKey: string,
      variables: Record<string, string>,
    ): Promise<CommandExecutionResult>;
  }

  interface CommandExecutionResult {
    stdout: string;
    stderr: string;
    exitCode: number;
  }
  ```

- **The Hidden Internals (Complexity):**
  - Retrieving raw list templates from `ConfigManager` configuration mappings.
  - Performing dynamic mapping of input variables into structural argument placeholders (such as substituting `{target}` in arrays) [1, 2].
  - Invoking process spawns via `child_process.spawn` using `shell: false` specifically to prevent injection strings or parameter expansions [2].

### Module 5: `WorkspaceSandboxExecutor` (Unified Executor Wrapper)

- **The Public API (Simple Interface):**
  ```typescript
  interface WorkspaceSandboxExecutor {
    initializeWorkspace(taskId: string): Promise<void>;
    executeModification(
      taskId: string,
      patch: SearchReplacePatch,
    ): Promise<void>;
    executeVerification(
      taskId: string,
      templateKey: string,
      variables: Record<string, string>,
    ): Promise<CommandExecutionResult>;
    finalizeWorkspace(taskId: string, commitChanges: boolean): Promise<void>;
  }
  ```
- **The Hidden Internals (Complexity):**
  - Encapsulating child sub-systems: orchestration coordinates sequences over `SandboxBranchManager`, `PatchExecutor`, and `SafeCommandExecutor` [2].
  - State orchestration ensuring that no verification actions run if workspace initialization fails.
  - Handling transactional rollbacks if any individual file modifications trigger errors or fail intermediate tests.

### Module 6: `LLMOrchestrator`

- **The Public API (Simple Interface):**

  ```typescript
  interface LLMOrchestrator {
    generateNextTurn(
      initialPrompt: string,
      history: ChatMessage[],
    ): Promise<LLMTurnResult>;
    pruneContext(history: ChatMessage[]): Promise<ChatMessage[]>;
  }

  interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
  }

  interface LLMTurnResult {
    thought: string;
    suggestedAction?: {
      type: "patch" | "command";
      payload: any;
    };
    isTerminal: boolean;
  }
  ```

- **The Hidden Internals (Complexity):**
  - Interfacing with the Vercel AI SDK and target models.
  - Formatting user prompts into structural message streams (handling zero-turn base insertions cleanly to protect LLM context visibility) [2].
  - Interfacing with prompt serializers and compiling text summaries for oldest turns when executing **Context Pruning** [1].

### Module 7: `AgenticLoopStateMachine`

- **The Public API (Simple Interface):**

  ```typescript
  interface AgenticLoopStateMachine {
    executeLoop(
      taskId: string,
      userInstruction: string,
    ): Promise<LoopCompletionStatus>;
  }

  interface LoopCompletionStatus {
    status: "complete" | "fail";
    summary: string;
  }
  ```

- **The Hidden Internals (Complexity):**
  - Managing structural loops executing agent operations.
  - Calculating and tracking running token totals / execution durations against context boundaries.
  - Triggering `LLMOrchestrator.pruneContext` once predefined performance/token limit triggers are tripped [2].
  - Interfacing with terminal adapters to output loading indicators and spinner statuses.

---

## 4. Functional Specifications & TDD Verification Specs

### REQ-01: Posix Configuration Directory Permission Enforcement

- **Description:** The system must establish configuration structures inside the folder path `~/.config/nexus/` with active Unix permissions restricted to `0o700` (User: Read, Write, Execute only) [2]. If directory accesses or modifications are run on non-Windows platforms, permissions must block any multi-user leakage [2].
- **Verification & Test Spec:**
  - _Setup:_ Environment state mock representing a standard Linux environment. Mock standard filesystem calls such as `fs.mkdir` and `fs.chmod`.
  - _Execution:_ Run `ConfigManager.initializeConfig()`.
  - _Assertion:_ Ensure `fs.mkdir` or `fs.chmod` is triggered against target directory with numerical value matching permission bitmask `0o700`.

### REQ-02: Stateless Sandbox Branch Orchestration with Git Isolation

- **Description:** When configuring a **Sandbox Environment**, all operations (e.g., branch switching, tracking) must accept a `taskId` directly through the call parameters instead of saving it in an internal state [1, 2].
- **Verification & Test Spec:**
  - _Setup:_ Mock child execution functions representing local git command environments.
  - _Execution:_ Invoke `SandboxBranchManager.applySandboxBranch("task-999")` followed by `restoreOriginalBranch("task-999")`.
  - _Assertion:_ Check that mock child execution triggers exact sequential system calls:
    1.  `git stash`
    2.  `git checkout -b agent/task-999`
    3.  Check that restore steps execute `git checkout -` and apply stashed data safely. Ensure no state is cached inside the class between calls.

### REQ-03: Safe Direct Process Execution (Shell-less Spawning)

- **Description:** Executable systems must run pre-approved **Parameterized Safe Commands** by applying variable substitutions strictly within index arrays, spawning processes via `child_process.spawn` where `shell: false` is forced [2].
- **Verification & Test Spec:**
  - _Setup:_ Register a system template mock configured as: `["npm", "run", "test", "--", "{target}"]` [2]. Mock the execution library `child_process.spawn`.
  - _Execution:_ Trigger `SafeCommandExecutor.executeCommand("test-template", { target: "; rm -rf /; " })`.
  - _Assertion:_ Verify that mock `child_process.spawn` was initiated with executable string `"npm"`, array parameter `["run", "test", "--", "; rm -rf /; "]`, and explicit option property `{ shell: false }`. Verify that the injection attempt is neutralized because it is treated as a single argument index rather than evaluated shell syntax [2].

### REQ-04: Enforced Uniqueness in Search-Replace Patches

- **Description:** The system must evaluate the occurrences of the target string in a search patch block [1, 2]. If more than one match exists within the target codebase file, execution must immediately halt and raise an `AmbiguousPatchError` to block duplicate edits [2].
- **Verification & Test Spec:**
  - _Setup:_ Instantiate a dummy file representation in-memory containing duplicate entries of structural brackets or common code (e.g., multiple identical lines `const x = 1;`). Configure a `SearchReplacePatch` payload looking to swap `const x = 1;` with `const x = 2;`.
  - _Execution:_ Run `PatchExecutor.applyPatch()` containing the mock details.
  - _Assertion:_ Validate that the method fails to modify the target and throws an instance of `AmbiguousPatchError` with a clear message indicating multiple matches were identified [2].

### REQ-05: LLM prompt injection initialization on empty state

- **Description:** At task initialization step zero, `LLMOrchestrator.generateNextTurn` must receive the initial user task prompt and register it as an early `"role": "user"` payload [2]. This ensures that empty turn sequences do not omit the task goal from the context window [2].
- **Verification & Test Spec:**
  - _Setup:_ Empty list array representation of current thread history. Task prompt variable set to `"Refactor users database controller"`.
  - _Execution:_ Run `LLMOrchestrator.generateNextTurn("Refactor users database controller", [])`.
  - _Assertion:_ Assert that the payload array transmitted to the LLM model includes at least one object elements where `role === "user"` and `content === "Refactor users database controller"`.

### REQ-06: Context Pruning Activation Threshold

- **Description:** The state machine must identify when historical conversation entries violate structural size thresholds and invoke context compressing algorithms [1, 2].
- **Verification & Test Spec:**
  - _Setup:_ Setup a mock run containing 20 messages in history representing 10 agent cycles. Establish size threshold constraints (e.g., 15 turns maximum).
  - _Execution:_ Invoke execution ticks within `AgenticLoopStateMachine` and evaluate transition steps.
  - _Assertion:_ Confirm that when turn boundaries are violated, the state machine calls `LLMOrchestrator.pruneContext()`, validating that old messages are summarized and consolidated cleanly.

---

## 5. Architectural Resolutions (Open Questions resolved)

### Resolved Conflict 1: Unified WorkspaceSandboxExecutor Integration Strategy

- **Trade-off Analysis:**
  - _Option A (Decoupled execution):_ Let the `AgenticLoopStateMachine` invoke the components (`SandboxBranchManager`, `PatchExecutor`, `SafeCommandExecutor`) sequentially. This keeps the execution structure flat but increases the state machine's complexity. The state machine must then handle low-level rollback concerns and transactional Git states, creating high system coupling.
  - _Option B (Unified Interface):_ Implement a wrapper component `WorkspaceSandboxExecutor` that orchestrates these three tasks. This abstracts sandboxing, patching, and testing behind a single system contract, keeping the state machine clean.
- **Recommended MVP Resolution:** Implement Option B. A clean, unified class `WorkspaceSandboxExecutor` will wrap the lower-level components and present a clean workspace interface [2].
- **Architectural Justification:** This maintains high conceptual integrity and modular separation of concerns. The `AgenticLoopStateMachine` does not need to know how branch stashing or process spawning works; it only needs to instruct the unified manager to apply changes or run checks, keeping the core loop clean and testable.

### Resolved Conflict 2: Context Pruning Activation Threshold and Rules

- **Trade-off Analysis:**
  - _Option A (Fixed Turn Count):_ Prune the context window after a fixed number of loop executions (e.g., 10 turns). This is simple to implement but does not account for actual token counts, meaning large files can still exhaust the LLM's context window before the turn limit is reached.
  - _Option B (Token-Based Dynamic Trigger):_ Use token estimations to trigger pruning when the context history reaches 80% of the target model's limits [2]. This is highly accurate but introduces a runtime dependency on token-counting libraries.
- **Recommended MVP Resolution:** Implement a hybrid approach. The `AgenticLoopStateMachine` will trigger **Context Pruning** if _either_ of these conditions is met:
  1.  The estimated total token usage exceeds **80% of the LLM model's maximum context limit** (estimated using direct character-to-token heuristic ratios: `1 token ≈ 4 characters` if no tokenizer library is available).
  2.  The loop count exceeds **15 iterative cycles** [2].

  When pruning, the oldest conversational turns (excluding the initial system instruction and the first task prompt) are compressed into a single summary block. The last two active turns are always kept intact to maintain immediate execution context.

- **Architectural Justification:** This keeps API consumption low, prevents context window exhaustion, and preserves the essential context needed for the model to continue its work [1, 2].

### Resolved Conflict 3: Command Array Mapping inside ConfigManager

- **Trade-off Analysis:**
  - _Option A (String Splitting Fallback):_ Store command templates as raw strings (e.g., `"npm run test -- {target}"`) and split them by spaces at runtime. This is highly vulnerable to breaking when arguments contain spaces, and risks shell execution workarounds if arguments are parsed incorrectly.
  - _Option B (Structured Array Mapping):_ Store templates strictly as JSON string arrays in the local `agent.config.json` (e.g., `["npm", "run", "test", "--", "{target}"]`) [2]. The `ConfigManager` will map these arrays directly, replacing placeholders with parameters index-by-index [2].
- **Recommended MVP Resolution:** Implement Option B [2]. Store commands as JSON string arrays in the local configuration file [2].
- **Architectural Justification:** This completely prevents shell-injection vulnerabilities [2]. Passing arguments to processes without using shell parsing ensures that input parameters are treated strictly as literal strings by the operating system, even if they contain typical shell control characters like `;`, `&`, or `|` [2]. This guarantees that arbitrary command injection remains impossible [2].

</PRODUCT_REQUIREMENTS_DOCUMENT>

---

# Execution Workflow

You must execute the assigned task in the following three distinct phases. Do not move to the next phase until I explicitly give you approval in our conversation.

### PHASE 1: PRE-FLIGHT CONTEXT CHECK, PRD BINDING & FILE REQUESTS

Analyze the target task, the workspace file structure, and the provided PRD. Before writing any code or tests, you must output a response containing:

1. **Your understanding of the task:** A concise summary of what needs to be built.
2. **PRD Variable Binding:** Explicitly identify and list:
   - The **Core Vision/Metaphor** (from PRD Section 1) that governs this task.
   - The relevant **Domain Dictionary Terms** (from PRD Section 2) that must be used in the code.
   - The specific **Module Interface Contract** (from PRD Section 3) that this task implements.
   - The specific **Functional Specification / REQ** (from PRD Section 4) that this task must satisfy.
3. **Required Files for Reference (Read-Only):** A list of existing files in the workspace you need to read to ensure architectural compatibility.
4. **Required Files for Modification (Read/Write Gate):** A list of any existing files (including implementation, tests, or configurations) that you _must_ edit to complete the task. **You must explicitly request the contents of these files now.**
5. **Assumptions & External Dependencies:** Any assumptions you are making about the current system state, and any necessary third-party package modifications (e.g., adding `better-sqlite3` or `vitest`).

_Wait for my response and file inputs before moving to Phase 2. Do not write any code or draft any tests yet._

### PHASE 2: DEFINE THE CONTRACT & TESTS (Red)

Once I approve Phase 1 and provide the requested files, you must generate:

1. **The TypeScript interfaces or types** representing the module's contract, matching the signatures defined in Section 3 of the PRD exactly.
2. **The Vitest test file (`*.test.ts`)** containing thorough test coverage asserting the expected behavior, edge cases, and side-effect isolation requirements.
3. A skeleton structure of the implementation file (`*.ts`) containing only empty functions/classes and types to allow the test file to compile.

_Your test design must verify all edge cases, expected failures, and mock standard node side-effects. Wait for me to run the test (which should fail) and give you the go-ahead for Phase 3._

### PHASE 3: IMPLEMENT THE CODE & MUTATION COMPATIBILITY (Green)

Once I confirm the test is drafted and compiles, you must generate:

1. **The minimal, clean implementation code (`*.ts`)** required to make the tests pass.
2. **The exact modifications for existing files (if approved in Phase 1):**
   - **Strict Compatibility Rule:** You must ensure all modifications to existing files are strictly **additive or backward-compatible**. You must NOT break, remove, or modify previous features or API signatures.
   - If a destructive or breaking change to an existing file is structurally unavoidable to complete the task, you must explicitly flag it as a `[BREAKING MUTATION]`, explain _why_ it is necessary, and wait for my explicit permission before generating it.
3. **Refactoring recommendations (if any):** Suggest improvements while keeping the test passing.

---

## TARGET TASK TO IMPLEMENT:

<INSERT TARGET TASK HERE>
````
