### Part 1: Dependency Graph (Text-Based)

The following diagram tracks the logical progression of development. Unblocked, foundational database and validation tasks are built first, followed by system logic, UI, and ultimately the main agentic loop integration.

```text
==============================================================================================
PHASE 1: Foundation (Config, Database, and Workspace Checks)
==============================================================================================
[TASK-01: Config Initializer] ---------> [TASK-02: SQLite Schema Setup]
                                                  |
                                                  v
                                         [TASK-03: DB Step Logs]
                                         [TASK-04: DB Cooldown Ops]

[TASK-05: Git Base Check] -------------> [TASK-06: Sandbox Git Stash & Branch]
                                                  |
                                                  v
                                         [TASK-07: Sandbox Merge & Restore]

==============================================================================================
PHASE 2: Execution Security & Patching Engines
==============================================================================================
[TASK-08: Shell Injection Check] ------> [TASK-09: Safe-Command Runner]

[TASK-10: Search-and-Replace Patching]

==============================================================================================
PHASE 3: LLM & UI Integration
==============================================================================================
[TASK-11: LLM Core Orchestration] -----> [TASK-12: LLM Rate Limit/Backoff] (Requires TASK-04)
                                  -----> [TASK-13: LLM History Context Pruner] (Requires TASK-03)

[TASK-14: Terminal UI Core] ------------> [TASK-15: UI Prompts & Diff Render]

==============================================================================================
PHASE 4: Orchestrated Runtime (Agentic Loop & CLI Harness)
==============================================================================================
[TASK-03] (DB Step logs) ---------\
[TASK-07] (Sandbox Lifecycle) -----\
[TASK-09] (Safe Execution) ---------\---> [TASK-16: Core Agentic Loop State Machine]
[TASK-10] (Code Patching) ----------/               |
[TASK-11] (LLM Core) -------------/                 v
[TASK-15] (UI Approvals) --------/        [TASK-17: Step Limit Enforcement]
                                                    |
                                                    v
                                          [TASK-18: Process Interrupt Handler]
                                                    |
                                                    v
                                          [TASK-19: CLI Hook Commands (init/run)]
==============================================================================================
```

---

### Part 2: Chronological Task Cards

#### [TASK-01]: Local Environment & Configuration Initialization

- **Description:** Implement local user-level configuration path resolution, generate the default workspace configuration file template `agent.config.json` in the current project root, and ensure the configuration directory path is secured with `0600` permissions.
- **Module Scope:**
  - _In Scope:_ Creation of `~/.config/nexus/.env` (credentials file) and root-level `agent.config.json`. File permission utility routines.
  - _Out of Scope:_ Actual SQLite file instantiation or interactive CLI questions.
- **Dependencies:**
  - _Blocked By:_ None
  - _Blocks:_ [TASK-02], [TASK-19]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock the home directory (`process.env.HOME`) to target a temporary filesystem path using `fs.mkdtempSync`.
  - _Test Execution & Assertion:_ Execute `ConfigManager.initializeConfig()`. Assert that `~/.config/nexus/` is successfully created, that its filesystem mode is verified as `0600` via `fs.statSync()`, and that an empty template `agent.config.json` containing default configuration settings exists in the current working directory.

---

#### [TASK-02]: SQLite Database Schema & Initialization

- **Description:** Setup and run database initialization scripts utilizing `better-sqlite3` to instantiate the SQLite storage database at `~/.config/nexus/history.db` with write-ahead logging (WAL) enabled.
- **Module Scope:**
  - _In Scope:_ Schema definitions for tables: `execution_sessions`, `step_logs`, and `provider_cooldowns`.
  - _Out of Scope:_ Data Insertion logic, log generation, or network tracking logic.
- **Dependencies:**
  - _Blocked By:_ [TASK-01]
  - _Blocks:_ [TASK-03], [TASK-04]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Configure a temporary database path in-memory (`:memory:`) or within a temporary directory.
  - _Test Execution & Assertion:_ Execute `SQLiteStorageManager.initializeDatabase()`. Run PRAGMA queries (`PRAGMA journal_mode;` and query sqlite_master) to assert that the database operates in `wal` mode and that the tables `execution_sessions`, `step_logs`, and `provider_cooldowns` exist with correct column structures.

---

#### [TASK-03]: SQLite Step Logging & History Operations

- **Description:** Implement step logging storage and historical step extraction routines matching the `SQLiteStorageManager` interface to record individual transaction steps.
- **Module Scope:**
  - _In Scope:_ Serialization and execution of SQL queries to insert data into `step_logs` and query histories ordered chronologically.
  - _Out of Scope:_ Token parsing algorithms or external LLM API logic.
- **Dependencies:**
  - _Blocked By:_ [TASK-02]
  - _Blocks:_ [TASK-13], [TASK-16]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Instantiate an initialized in-memory SQLite helper.
  - _Test Execution & Assertion:_ Call `SQLiteStorageManager.saveStep("session-abc", 1, { timestamp: "2026-06-30T12:00:00Z", toolName: "read_file", args: { path: "src/auth.ts" }, tokenCountEstimate: 150 })`. Retrieve using `SQLiteStorageManager.getSessionHistory("session-abc")`. Assert that the history length is 1, and the returned payload matches the serialized step input.

---

#### [TASK-04]: SQLite Rate-Limit Cooldown Operations

- **Description:** Implement storage tracking functions to save and retrieve rate-limit epoch timestamps per LLM provider to protect against executing requests during active lockouts.
- **Module Scope:**
  - _In Scope:_ Writing and reading key-value pairings of provider names and Unix cooldown timestamps to/from `provider_cooldowns`.
  - _Out of Scope:_ Dynamic network interceptors or retry backoff delay execution loop wrappers.
- **Dependencies:**
  - _Blocked By:_ [TASK-02]
  - _Blocks:_ [TASK-12]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Initialize a mock database session helper.
  - _Test Execution & Assertion:_ Call `SQLiteStorageManager.logRateLimitCooldown("openai", 1782844800000)`. Retrieve cooldown value via `SQLiteStorageManager.getRateLimitCooldown("openai")`. Assert that the returned timestamp matches `1782844800000`. Assert that a query for an unlisted provider return `null`.

---

#### [TASK-05]: Git Base Validation Check

- **Description:** Implement pre-flight environmental validation checks to assert that the executing workspace path contains an active, valid Git repository.
- **Module Scope:**
  - _In Scope:_ Execution of raw Git check operations using Node.js `child_process`.
  - _Out of Scope:_ Branch switching, modifications, or stashing operations.
- **Dependencies:**
  - _Blocked By:_ None
  - _Blocks:_ [TASK-06]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Create two test directories: one initialized with `git init` and one basic, empty directory.
  - _Test Execution & Assertion:_ Execute `GitValidator.isGitRepository()` in both targets. Assert that the Git-initialized workspace directory returns `true` and the basic directory returns `false` or throws a clear error.

---

#### [TASK-06]: Sandbox Branching - Branch Creation & Stashing

- **Description:** Implement the startup phase of Sandbox Branching [REQ-03] by stashing uncommitted modifications and creating an isolated tracking branch.
- **Module Scope:**
  - _In Scope:_ Git stash commands, branch generation `agent/[task-uuid]`, and command exit safety.
  - _Out of Scope:_ Git branch merging or original working directory restoration.
- **Dependencies:**
  - _Blocked By:_ [TASK-05]
  - _Blocks:_ [TASK-07]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Initialize a test Git workspace. Create an uncommitted file modification on `main`.
  - _Test Execution & Assertion:_ Instantiate `SandboxBranchManager` and invoke `applySandboxBranch("task-uuid-456")`. Assert that the active working branch becomes `agent/task-uuid-456` and that `git status` reports clean working parameters, verifying files are securely stashed.

---

#### [TASK-07]: Sandbox Branching - Recovery & Merging

- **Description:** Implement the finalization and cleanup phases of Sandbox Branching [REQ-03] by merging successfully validated branches or cleanly discarding failed iterations and restoring stashed edits.
- **Module Scope:**
  - _In Scope:_ Fast-forward branch merging, tracking branch deletions, stashed change recovery (`git stash pop`), and hard resets.
  - _Out of Scope:_ UI confirmation logic, which is handled via prompt interfaces.
- **Dependencies:**
  - _Blocked By:_ [TASK-06]
  - _Blocks:_ [TASK-16]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Establish a Git testing environment. Create dirty modifications, execute `applySandboxBranch("task-789")`, and add a mock commit on the agent sandbox branch.
  - _Test Execution & Assertion:_ Call `restoreOriginalBranch()`. Verify that the branch reverts back to `main` and the branch `agent/task-789` is cleanly deleted. Ensure the original uncommitted modifications are popped from the stash and restored.

---

#### [TASK-08]: Parameterized Safe-Command Shell-Injection Validator

- **Description:** Create a robust validation utility to parse incoming target file path arguments for parameterized terminal execution blocks to prevent command chain injection [REQ-04].
- **Module Scope:**
  - _In Scope:_ Sanitizing strings against unsafe operators such as `;`, `&&`, `|`, `` ` ``, `$()`, and checking directory escape patterns (e.g., `..`).
  - _Out of Scope:_ Actual shell subprocess spawning.
- **Dependencies:**
  - _Blocked By:_ None
  - _Blocks:_ [TASK-09]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Define dynamic string variables containing injection patterns.
  - _Test Execution & Assertion:_ Pass validation checks with `SafeCommandValidator.validateTargetPath("src/auth.test.ts")` (must pass). Pass invalid string `src/auth.test.ts; rm -rf /` (must throw `Invalid parameter path: shell metacharacter injection detected`).

---

#### [TASK-09]: Parameterized Safe-Command Executor

- **Description:** Execute predefined, parameterized system testing commands within a safe process sandbox, returning raw results or structured error trace payloads [REQ-04].
- **Module Scope:**
  - _In Scope:_ Mapping argument configurations to command templates (e.g., `npm run test -- {target}`) and handling process execution utilizing `child_process.execSync`.
  - _Out of Scope:_ Standard Shell Command line expansions that bypass templates.
- **Dependencies:**
  - _Blocked By:_ [TASK-08]
  - _Blocks:_ [TASK-16]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Configure a safe test command template key inside code mocks.
  - _Test Execution & Assertion:_ Run `SafeCommandExecutor.execute("test-cmd", "src/file.ts")`. Assert that the executed system command string matches the configuration target. Catch execution errors, verify that stderr flows are captured, and that they are wrapped in standardized XML-style compiler error blocks [REQ-05].

---

#### [TASK-10]: Search-and-Replace Block Code Patching

- **Description:** Implement the code modification engine to apply structured, contextual search-and-replace alterations directly to target local workspace files [REQ-05].
- **Module Scope:**
  - _In Scope:_ Locating exact multi-line text matches within target files, substituting them, and throwing precise exception payloads when exact matches are not resolved.
  - _Out of Scope:_ Whole-file rewrite routines or structural AST generation parsing.
- **Dependencies:**
  - _Blocked By:_ None
  - _Blocks:_ [TASK-16]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Write a mock target file containing structured sample lines.
  - _Test Execution & Assertion:_ Invoke `PatchExecutor.applyPatch()` with parameters `find: "const y = 10;"`, `replace: "const y = 20;"`. Assert file matches expected output. Re-run task targeting a non-matching pattern, asserting it throws `Patch failed: Target match pattern not resolved in file`.

---

#### [TASK-11]: LLM Orchestration - Basic Tool Call and Next Turn Generator

- **Description:** Implement the base integration wrapper for the Vercel AI SDK to query configured model engines, process chat logs, and interpret standard structured agent decisions.
- **Module Scope:**
  - _In Scope:_ Transforming internal step states into LLM chat schemas, calling endpoint integrations, and mapping responses to structured `AgenticDecision` formats.
  - _Out of Scope:_ Automatic rate-limit pauses or prompt-history summarization routines.
- **Dependencies:**
  - _Blocked By:_ None
  - _Blocks:_ [TASK-12], [TASK-13], [TASK-16]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock the underlying Vercel AI SDK network endpoint client.
  - _Test Execution & Assertion:_ Execute `LLMOrchestrator.generateNextTurn("session-1", [], [])`. Assert the returned object matches the structure `{ type: "tool_call", toolCall: { id: "123", name: "read_file", args: {} } }` when simulated API outputs indicate tool actions.

---

#### [TASK-12]: LLM Orchestration - Cooldown & Rate Limit Exponential Backoff

- **Description:** Handle LLM rate limit responses (HTTP status `429`), extract target recovery details, log provider block durations, and execute backoff sleep delays [REQ-07].
- **Module Scope:**
  - _In Scope:_ Intercepting 429 response streams, parsing standard retry headers, and executing database cooldown updates.
  - _Out of Scope:_ Actual runtime model queries (mocked).
- **Dependencies:**
  - _Blocked By:_ [TASK-04], [TASK-11]
  - _Blocks:_ [TASK-16]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Configure a mocked API network layer designed to throw an HTTP 429 exception with a `retry-after: 1` header.
  - _Test Execution & Assertion:_ Trigger `LLMOrchestrator.generateNextTurn()`. Assert that the orchestrator catches the exception, updates the provider cooldown state in the DB, registers a one-second pause delay, and then successfully retries the invocation.

---

#### [TASK-13]: LLM Orchestration - Context Summarization & History Pruning

- **Description:** Implement historical token control parameters to summarize system events that occurred more than 4 steps back [REQ-06].
- **Module Scope:**
  - _In Scope:_ Condensing historical record step elements into concise summaries using dedicated summarization prompts, keeping the last 2 actions in raw format.
  - _Out of Scope:_ Local database pruning (only in-memory context manipulation).
- **Dependencies:**
  - _Blocked By:_ [TASK-03], [TASK-11]
  - _Blocks:_ [TASK-16]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Build a history array composed of 5 detailed execution step structures. Mock the LLM summarization API response to return `"Summary of Step"`.
  - _Test Execution & Assertion:_ Execute `LLMOrchestrator.pruneContext(history)`. Assert that the returned array length is reduced, with the first two records compressed to `"Summary of Step"`, while the final two steps preserve their detailed properties.

---

#### [TASK-14]: Terminal Interface - Spinner and Visual Displays

- **Description:** Setup terminal screen presentation controls using `@clack/prompts` to deliver non-blocking loading spinners and structured output layouts.
- **Module Scope:**
  - _In Scope:_ Wrapping `@clack/prompts` indicators, color management, and standard output streaming hooks.
  - _Out of Scope:_ User interactive prompt answers or custom rendering structures.
- **Dependencies:**
  - _Blocked By:_ None
  - _Blocks:_ [TASK-15]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Spy on standard outputs (`process.stdout.write`).
  - _Test Execution & Assertion:_ Execute `TerminalInterface.showSpinner("Saving Workspace Status...")`. Assert that the appropriate ANSI sequences and text instructions are written to standard output.

---

#### [TASK-15]: Terminal Interface - Approvals & Diff Rendering

- **Description:** Implement interactive console prompting routines and formatted Git diff blocks within the terminal layout.
- **Module Scope:**
  - _In Scope:_ Interactive prompt responses (such as `[Y/n]` inputs) and styled block diff renders using standard ANSI highlights.
  - _Out of Scope:_ File path calculations or actual Git branch creation.
- **Dependencies:**
  - _Blocked By:_ [TASK-14]
  - _Blocks:_ [TASK-16]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock standard interactive terminal input streams (`process.stdin`).
  - _Test Execution & Assertion:_ Trigger `TerminalInterface.requestUserApproval("Do you authorize this execution?")`. Feed simulated input values representing `"Y"` and `"n"`. Assert that the resolved promise returns `true` and `false` respectively.

---

#### [TASK-16]: Agentic Loop State Machine - Core State Orchestration

- **Description:** Build the core state driver class to coordinate processing steps, evaluate tool requests, execute local targets, and update log registries [REQ-01].
- **Module Scope:**
  - _In Scope:_ Transitioning execution sequences through planning, approval evaluation, safe-tool runs, and tracking results.
  - _Out of Scope:_ Execution boundary steps or process signal capturing.
- **Dependencies:**
  - _Blocked By:_ [TASK-03], [TASK-07], [TASK-09], [TASK-10], [TASK-11], [TASK-15]
  - _Blocks:_ [TASK-17]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock the `LLMOrchestrator`, `SandboxExecutor`, and `SQLiteStorageManager`. Configure the mock model to return a tool run request on step 1, and return a completed state representation on step 2.
  - _Test Execution & Assertion:_ Invoke `AgenticLoopStateMachine.start("Refactor login verification system")`. Assert that storage manager tracking files register both execution iterations, and that the target sandbox modifications execute as defined.

---

#### [TASK-17]: Agentic Loop State Machine - Step Limit Enforcement

- **Description:** Integrate step limit boundaries within the loop control routines to guard against runaway executions [REQ-02].
- **Module Scope:**
  - _In Scope:_ Monitoring consecutive loop iteration counters and throwing terminating exceptions if bounds are exceeded.
  - _Out of Scope:_ General execution loop state logic.
- **Dependencies:**
  - _Blocked By:_ [TASK-16]
  - _Blocks:_ [TASK-18]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Configure the maximum loop execution bounds constraint to `3`. Set up a mocked LLM driver designed to continuously issue read operations.
  - _Test Execution & Assertion:_ Call `AgenticLoopStateMachine.start("Audit code base patterns")`. Confirm that execution stops at step 3, and assert that the loop throws an execution error containing: `"Step Limit limit of 3 reached. Terminating loop to prevent runaway behavior"`.

---

#### [TASK-18]: Process Interrupt Handling & Cleanup

- **Description:** Capture system SIGINT (`Ctrl+C`) actions, cleanly persist current execution steps to the database, and display sandbox environment recovery prompts.
- **Module Scope:**
  - _In Scope:_ Capturing SIGINT, writing current step state data, prompting for manual sandbox retention, and returning the active terminal branch to its clean, pre-session state.
  - _Out of Scope:_ Standard exit procedures during normal, error-free completions.
- **Dependencies:**
  - _Blocked By:_ [TASK-17]
  - _Blocks:_ [TASK-19]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Spy on the database save procedures and mock user selection prompts to return `false` (discard branch).
  - _Test Execution & Assertion:_ Run a long-running execution mock and simulate a `process.emit('SIGINT')` signal. Assert that active step data is saved, the user prompt is displayed, and standard restoration cleanup commands (`restoreOriginalBranch`) are invoked.

---

#### [TASK-19]: CLI Runtime Hook Commands (`nexus init`, `nexus run`)

- **Description:** Establish the primary binary entry points mapping global console runtime parameters to initialization routines and execution states.
- **Module Scope:**
  - _In Scope:_ Wiring `nexus init` to trigger setup targets, and mapping `nexus run "<prompt>"` to prompt the state machine.
  - _Out of Scope:_ Internal state transition logic (delegated entirely to the modules).
- **Dependencies:**
  - _Blocked By:_ [TASK-01], [TASK-18]
  - _Blocks:_ None
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock the command-line argument array (`process.argv`).
  - _Test Execution & Assertion:_ Pass CLI parameters `["node", "nexus", "init"]`. Assert that the configuration files generate as expected. Pass `["node", "nexus", "run", "Fix bug"]` and verify that the core `AgenticLoopStateMachine` starts correctly.
