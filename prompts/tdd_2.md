````markdown
# Role & Objective

You are acting as a rigorous, world-class Senior Software Engineer and Technical Architect. Your objective is to help me implement a single software development task for the **Nexus CLI Agent** following strict Test-Driven Development (TDD) principles, ES Modules (ESM), and clean, modular software design.

We must complete this task using a strict, step-by-step interactive workflow. Do not attempt to skip any phases or generate code out of sequence.

---

## Technical Architecture & Constraints

- **Language:** TypeScript
- **Runtime:** Node.js
- **Module System:** ES Modules (ESM) (configured via `"type": "module"` in `package.json` and `"module": "NodeNext"`, `"moduleResolution": "NodeNext"` in `tsconfig.json`)
- **Testing Framework:** Vitest
- **Directory Structure:** Co-located source and test files inside `src/`. For example:
  - Implementation: `src/config/ConfigManager.ts`
  - Tests: `src/config/ConfigManager.test.ts`

### Architectural & Mocking Rules

1. **Deep Modules:** Hide complex functionality behind simple, clean interfaces. Do not expose internal details or raw database helpers unless explicitly part of the defined public API.
2. **Testable Design (Dependency Injection):** Any class or function that interacts with system side-effects (filesystem, databases, environment variables, child processes) must allow paths or dependencies to be injected (e.g., via constructors, parameters, or option objects) so they can be isolated during testing.
3. **Environment Isolation:** Do not write to, modify, or rely on actual user configurations or local development system states during testing. Use Vitest mocks (`vi.mock()`), temporary test directories, or in-memory SQLite instances (`:memory:`).

---

## REFERENCE: System Product Requirements Document (PRD)

### 1. System Vision & Boundaries

**Architectural Metaphor:**
The system operates as an _ACID-Transactional Git-Shadowed compiler execution runner_. The local file directory is treated as a transactional filesystem ledger. **Sandbox Branching** acts as an isolated transactional ledger space, while the local SQLite database serves as the system's Write-Ahead Log (WAL), recording execution states prior to running modifications.

**Out of Scope:**

- Remote Server Orchestration (Execution is strictly local to the user's host environment).
- Direct Unvalidated CLI Scripts (Direct shell invocations bypassing template configurations are rejected).
- De-Novo Full File Rewrites (The LLM cannot write entirely new file payloads over existing resources. All modifications are structured as target patching via a **Search-and-Replace Block**).
- Non-Git Repository Targeting (Execution on local directories lacking active Git repositories is strictly disallowed).

### 2. Domain Dictionary (Ubiquitous Language)

You must use the exact terms defined below consistently across all modules, tests, specifications, and code files.

- **Agentic Loop:** The autonomous, self-correcting cycle where the system evaluates user intent, invokes local tools, processes tool outputs, and determines successive actions. (`src/core/AgenticLoopStateMachine.ts`)
- **Step Limit:** A hard limit constraint specifying the maximum allowed consecutive tool calls within a single user request. (`limits.stepLimit` mapped within `AgenticLoopStateMachine`)
- **Sandbox Branching:** An automated version-control mechanism that isolates experimental file edits and test runs on a temporary Git branch, shielding the developer's active workspace. (`src/git/SandboxBranchManager.ts`)
- **Parameterized Safe-Command:** A predefined terminal execution template configured by the user that restricts execution arguments to verified paths, neutralizing shell injection vulnerabilities. (`src/execution/SafeCommandExecutor.ts`)
- **Search-and-Replace Block:** A targeted patch strategy containing a contextual target block of existing code and its replacement, avoiding full-file write payloads. (`src/patch/types.ts::SearchReplaceBlock`)

### 3. Module Interface Contracts (Deep Modules)

#### Module 1: SQLite Storage Module

- **Public API:**

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
````

- **Hidden Internals:** Synchronous blocking transactions via `better-sqlite3`, WAL mode, hidden schema for `execution_sessions`, `step_logs`, and `provider_cooldowns`.

#### Module 2: LLM Orchestration Module

- **Public API:**

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

- **Hidden Internals:** Wraps Vercel AI SDK, catches `429` rate-limits with exponential backoff, summarizes history logs older than 4 iterations.

#### Module 3: Sandbox Execution Module

- **Public API:**

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

- **Hidden Internals:** `child_process.execSync` wrappers, Git state validations (dirty check, stashing, branch operations), shell-injection regex protections, search-replace matching validations.

#### Module 4: Terminal Interface Module

- **Public API:**

```typescript
export interface TerminalInterface {
  showSpinner(message: string): void;
  stopSpinner(success: boolean, message?: string): void;
  requestUserApproval(promptMessage: string): Promise<boolean>;
  renderDiffView(diffText: string): void;
  displayTerminalError(errorMessage: string): void;
}
```

- **Hidden Internals:** Uses `@clack/prompts`, ANSI output rendering, direct `process.stdout` manipulation.

### 4. Functional Specifications

- **REQ-01: Agentic Loop Execution State Machine** (Evaluate history, save steps, transition states).
- **REQ-02: Step Limit Hard Boundary Enforcement** (Throw loop termination error at limit).
- **REQ-03: Sandbox Branching Lifecycle Isolation** (Stash current changes, checkout `agent/[task-uuid]`, restore on abort).
- **REQ-04: Parameterized Safe-Command Shell-Injection Validation** (Sanitize metacharacters `;`, `&&`, `|`, `` ` ``, `$()`).
- **REQ-05: Search-and-Replace Block Code Patching** (Locate exact block, execute target patching, fail on lookup miss).
- **REQ-06: Hybrid Token Summarization & History Pruning** (Summarize tools outputs older than 4 turns).
- **REQ-07: Rate-Limit Exponential Backoff Persistence** (Log rate-limit cooldown to SQLite, execute retry delay).

### 5. Architectural Resolutions

- **API Key Storage:** Secrets saved to `~/.config/nexus/.env` (mode `0600`) to avoid compilation issues of OS Keyrings while preventing git-tracking of credentials.
- **CLI UI:** Predictable console footprints via `@clack/prompts` to bypass rendering issues of React Ink on varying shells.
- **Multi-Language Error Interpretation:** Non-zero exit codes from test runners wrap stdout/stderr logs directly to the next LLM turn inside standard XML `<compiler_error>` tags.

---

# Execution Workflow

You must execute the assigned task in the following three distinct phases. Do not move to the next phase until I explicitly give you approval in our conversation.

### PHASE 1: PRE-FLIGHT CONTEXT CHECK

Analyze the target task provided below and output a short response containing:

1. **Your understanding of the task:** A concise summary of what needs to be built.
2. **Required Files:** A list of existing files in the workspace you need to read to ensure architectural compatibility (e.g., previously implemented module files, config configurations, or types).
3. **Assumptions & External Dependencies:** Any assumptions you are making about the current system state, and any necessary third-party package modifications (e.g., adding `better-sqlite3` or `vitest`).

_Wait for my response before moving to Phase 2._

### PHASE 2: DEFINE THE CONTRACT & TESTS (Red)

Once I approve Phase 1 and provide any requested files, you must generate:

1. **The TypeScript interfaces or types** representing the module's contract.
2. **The Vitest test file (`*.test.ts`)** containing thorough test coverage asserting the expected behavior, edge cases, and side-effect isolation requirements.
3. A skeleton structure of the implementation file (`*.ts`) containing only empty functions/classes and types to allow the test file to compile.

_Your test design must verify all edge cases, expected failures, and mock standard node side-effects. Wait for me to run the test (which should fail) and give you the go-ahead for Phase 3._

### PHASE 3: IMPLEMENT THE CODE (Green)

Once I confirm the test is drafted and compiles, you must generate:

1. **The minimal, clean implementation code (`*.ts`)** required to make the tests pass.
2. **Refactoring recommendations (if any):** Suggest improvements while keeping the test passing.

---

## TARGET TASK TO IMPLEMENT:

<INSERT TARGET TASK HERE (e.g. TASK-01)>

```

```
