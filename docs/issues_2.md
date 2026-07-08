### Part 1: Dependency Graph (Text-Based)

The development of the `nexus` Autonomous Coding Agent is divided into three key phases, moving from foundational isolated utilities to transaction management, and finally to cognitive loop integration.

```text
========================================================================================
PHASE 1: FOUNDATIONAL ISOLATED UTILITIES
========================================================================================

  [TASK-01: Config POSIX Init] ──> [TASK-02: Config JSON Parsing]
                                                    │
  [TASK-03: Patch Execution] ───────────────────────┼──────────────┐
                                                    │              │
                                                    ▼              │
                                    [TASK-04: Safe Shell-less Run] │
                                                    │              │
                                                    ▼              │
  [TASK-05: Sandbox Git Setup] ──> [TASK-06: Sandbox Git Restore]  │
                                                    │              │
========================================================================================
PHASE 2: ORCHESTRATED SANDBOX ENVIRONMENT
========================================================================================
                                                    │              │
                                                    ▼              │
                                    [TASK-07: Sandbox Lifecycle] ◄─┘
                                                    │
                                                    ▼
                                    [TASK-08: Sandbox Transactions]
                                                    │
========================================================================================
PHASE 3: COGNITIVE & CORE STATE LOOP
========================================================================================
                                                    │
  [TASK-09: LLM Zero-Turn Init] ──> [TASK-10: LLM Context Pruning] │
                                                    │              │
                                                    ▼              │
                                    [TASK-11: Core State Machine] ◄┘
                                                    │
                                                    ▼
                                    [TASK-12: End-to-End Orchestration]
```

---

### Part 2: Chronological Task Cards

#### [TASK-01]: ConfigManager POSIX Directory Permission Enforcement

- **Description:** Implement `ConfigManager.initializeConfig()` and `ConfigManager.getConfigDirectoryPath()`. The module must establish the workspace configuration directory `~/.config/nexus/` and enforce a restrictive Unix permission mask of `0o700` (User read/write/execute only) on non-Windows environments to prevent multi-user permission leaks.
- **Module Scope:**
  - _In Scope:_ `ConfigManager` directory creation, POSIX environment checks, `fs` module permission setting (`0o700`), fallback handlers for Windows environments where Unix flags are ignored.
  - _Out of Scope:_ Loading or validating the `agent.config.json` content file structure.
- **Dependencies:**
  - _Blocked By:_ None
  - _Blocks:_ [TASK-02]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock POSIX platform environment (`process.platform = 'linux'`), mock filesystem modules `fs.promises.mkdir` and `fs.promises.chmod`, and mock homedir resolution.
  - _Test Execution & Assertion:_ Call `ConfigManager.initializeConfig()`. Assert that `fs.promises.mkdir` is called with the resolved path matching `~/.config/nexus/` and that `fs.promises.chmod` is triggered with the octal mask `0o700`.

---

#### [TASK-02]: ConfigManager JSON File Parsing & Template Retrieval

- **Description:** Implement `ConfigManager.getCommandTemplate(key)`. The manager must read and parse `agent.config.json` inside the initialized configuration directory. It must load execution configurations, verifying that predefined safe commands are represented strictly as array templates rather than vulnerable raw execution strings.
- **Module Scope:**
  - _In Scope:_ Reading and validating `agent.config.json` using JSON.parse, returning string arrays associated with structural keys.
  - _Out of Scope:_ Actual runtime process spawning or substitution of placeholders.
- **Dependencies:**
  - _Blocked By:_ [TASK-01]
  - _Blocks:_ [TASK-04], [TASK-11]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock `fs.promises.readFile` to return a valid JSON payload containing the mapping `{"test": ["npm", "run", "test", "--", "{target}"]}`.
  - _Test Execution & Assertion:_ Invoke `ConfigManager.getCommandTemplate("test")`. Assert that the returned array is equivalent to `["npm", "run", "test", "--", "{target}"]`. Assert that an error is thrown if the configuration contains raw string definitions instead of string arrays.

---

#### [TASK-03]: PatchExecutor Search-Replace Core & Multi-Match Detection

- **Description:** Implement `PatchExecutor.applyPatch()`. Read local target codebase files using UTF-8 encoding, perform line-aligned search and replace modifications, and detect overlapping or multi-match instances within the file body.
- **Module Scope:**
  - _In Scope:_ File buffer manipulation, character decoding, line-by-line target matching logic, and raising a specialized `AmbiguousPatchError` when finding duplicate target occurrences.
  - _Out of Scope:_ Interfacing with Git branch commands or creating backup files.
- **Dependencies:**
  - _Blocked By:_ None
  - _Blocks:_ [TASK-08]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock `fs.promises.readFile` and `fs.promises.writeFile`. Set up the mock file stream to contain duplicate target segments:
    ```typescript
    const code = "const x = 1;\nconsole.log(x);\nconst x = 1;";
    ```
  - _Test Execution & Assertion:_ Call `PatchExecutor.applyPatch()` with a patch containing `find: "const x = 1;"` and `replace: "const x = 2;"`. Verify that an `AmbiguousPatchError` is thrown and that no changes are written to the filesystem mock.

---

#### [TASK-04]: SafeCommandExecutor Shell-less Process Spawning

- **Description:** Implement `SafeCommandExecutor.executeCommand()`. Dynamically bind variables into index positions within defined template arrays, and execute processes using `child_process.spawn` ensuring `shell: false` is hardcoded to prevent injection vulnerabilities.
- **Module Scope:**
  - _In Scope:_ Template variable replacement mechanisms, raw shell-less command executions, parsing process exit codes, and reading stdout/stderr buffers.
  - _Out of Scope:_ Fetching raw template configuration details from disk directly (dependencies should be supplied dynamically or resolved through a passed instance of `ConfigManager`).
- **Dependencies:**
  - _Blocked By:_ [TASK-02]
  - _Blocks:_ [TASK-08]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock `child_process.spawn` to return custom streams and exit code handlers without triggering real execution cycles.
  - _Test Execution & Assertion:_ Call `SafeCommandExecutor.executeCommand` with template array `["npm", "run", "test", "--", "{target}"]` and substitutions `{ target: "; rm -rf /; " }`. Assert that the spawned process arguments array receives exactly `["run", "test", "--", "; rm -rf /; "]` and that the options block explicitly includes `{ shell: false }`.

---

#### [TASK-05]: SandboxBranchManager Git Isolation & Stash Setup

- **Description:** Implement stateless Git checkout and stashing routines in `SandboxBranchManager.applySandboxBranch()`. Stash any untracked or active local workspace changes, check out a clean transient target branch keyed by `taskId` (`agent/[taskId]`), and manage Git operation logs.
- **Module Scope:**
  - _In Scope:_ Command execution of Git stashing and checkout via system shell execution using `child_process.execFile`. Ensuring zero static internal class states are written or saved during executions.
  - _Out of Scope:_ Reverting sandbox modifications, branch cleanup tasks, or managing patch file transformations.
- **Dependencies:**
  - _Blocked By:_ None
  - _Blocks:_ [TASK-06]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock the module running local process executions (`child_process.execFile`).
  - _Test Execution & Assertion:_ Call `SandboxBranchManager.applySandboxBranch("task-alpha")`. Assert that the exact sequential list of native commands is triggered:
    1. `git stash` (to store developer-owned unstaged changes)
    2. `git checkout -b agent/task-alpha`

---

#### [TASK-06]: SandboxBranchManager Restore and Merge Operations

- **Description:** Implement rollback and merging routines in `SandboxBranchManager.restoreOriginalBranch()` and `SandboxBranchManager.mergeSandboxBranch()`. These methods will reset changes, check back out the original working branch, restore active user stashes cleanly, and merge target workspace session modifications on successful test completions.
- **Module Scope:**
  - _In Scope:_ Local Git tracking routines to resolve previous active branch names, merge checks, branch deletes, and applying previous developer stashes.
  - _Out of Scope:_ Initiating file-level mutations or executing unit test checks directly.
- **Dependencies:**
  - _Blocked By:_ [TASK-05]
  - _Blocks:_ [TASK-07]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock native Git executions and state indicators within the target mock repository environment.
  - _Test Execution & Assertion:_ Invoke `SandboxBranchManager.restoreOriginalBranch("task-alpha")` while tracking original branch metadata mock inputs. Assert that native calls are made to checkout the baseline user branch, delete branch `agent/task-alpha`, and execute `git stash pop` to restore previous developer modifications.

---

#### [TASK-07]: WorkspaceSandboxExecutor Unified Lifecycle Orchestration

- **Description:** Implement the structural wrapper orchestrations `WorkspaceSandboxExecutor.initializeWorkspace()` and `WorkspaceSandboxExecutor.finalizeWorkspace()`. These components act as a transactional controller, wrapping lower-level Git isolation state logic to ensure reliable environment setup and teardown.
- **Module Scope:**
  - _In Scope:_ Coordinating `SandboxBranchManager` setups, managing sequence errors, tracking current transaction workspace lifecycles, and ensuring a rollback occurs if any workspace initialization fails.
  - _Out of Scope:_ Performing actual in-file changes or executing test suite templates.
- **Dependencies:**
  - _Blocked By:_ [TASK-06]
  - _Blocks:_ [TASK-08]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock `SandboxBranchManager` methods (`applySandboxBranch`, `restoreOriginalBranch`, `mergeSandboxBranch`).
  - _Test Execution & Assertion:_ Call `WorkspaceSandboxExecutor.initializeWorkspace("task-beta")`. Assert that the sequence triggers `SandboxBranchManager.applySandboxBranch("task-beta")`. Call `finalizeWorkspace("task-beta", false)`. Assert that the system triggers rollback procedures via `SandboxBranchManager.restoreOriginalBranch("task-beta")`.

---

#### [TASK-08]: WorkspaceSandboxExecutor Transactional Operations

- **Description:** Implement `WorkspaceSandboxExecutor.executeModification()` and `WorkspaceSandboxExecutor.executeVerification()`. These unified interfaces apply line edits and execute pre-approved testing constraints on the sandboxed branch, triggering immediate rollbacks if any individual action throws an exception.
- **Module Scope:**
  - _In Scope:_ Orchestrating sequential validation pipelines using `PatchExecutor` and `SafeCommandExecutor`, resolving task IDs, and capturing process execution outputs.
  - _Out of Scope:_ Directly evaluating LLM prompts or managing conversational history objects.
- **Dependencies:**
  - _Blocked By:_ [TASK-03], [TASK-04], [TASK-07]
  - _Blocks:_ [TASK-12]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock `PatchExecutor` and `SafeCommandExecutor`. Program the mock execution commands to simulate a failed compiler check (exit code non-zero).
  - _Test Execution & Assertion:_ Call `WorkspaceSandboxExecutor.executeVerification("task-beta", "test-run", {})`. Ensure that upon receiving a failed compilation result, an exception is thrown to abort the sandbox transaction.

---

#### [TASK-09]: LLMOrchestrator Base States & Zero-Turn Initialization

- **Description:** Implement `LLMOrchestrator.generateNextTurn()`. Formulate prompt templates, integrate the LLM driver interface (Vercel AI SDK wrapper), and enforce state rules where empty turn requests inject the initial goal directly into the active prompt window.
- **Module Scope:**
  - _In Scope:_ Mapping system messages, structuring input arrays, verifying empty turn sequences, and packaging outputs into the uniform response shape `LLMTurnResult`.
  - _Out of Scope:_ Performing message pruning or tracking run loops.
- **Dependencies:**
  - _Blocked By:_ None
  - _Blocks:_ [TASK-10]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock the core Vercel AI SDK payload transport mechanisms.
  - _Test Execution & Assertion:_ Call `LLMOrchestrator.generateNextTurn("Fix db connection", [])`. Assert that the array payload constructed for the downstream model includes at least one object mapping where `role === "user"` and `content === "Fix db connection"`.

---

#### [TASK-10]: LLMOrchestrator Context Pruning Heuristics

- **Description:** Implement `LLMOrchestrator.pruneContext()`. Implement context-pruning rules that compress long transaction logs into a cohesive system summary text, ensuring the first user instruction is preserved and the last two active context turns are retained.
- **Module Scope:**
  - _In Scope:_ Thread history compression, analyzing array indexes, and constructing summarization requests to shrink the active context history window.
  - _Out of Scope:_ Parsing codebase patches or executing sandbox tests.
- **Dependencies:**
  - _Blocked By:_ [TASK-09]
  - _Blocks:_ [TASK-11]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Prepare a test context history array containing 20 sequential messages (10 interaction turns) where the initial entry represents the system instruction and task goal. Mock the LLM summarization response.
  - _Test Execution & Assertion:_ Call `LLMOrchestrator.pruneContext(history)`. Assert that the returned pruned history contains the initial system instruction, the compressed summary block of historical entries, and the last two turns fully intact.

---

#### [TASK-11]: AgenticLoopStateMachine Iteration Controller

- **Description:** Implement `AgenticLoopStateMachine.executeLoop()`. Manage state transitions, integrate terminal spinners, track loop iterations, and monitor context limits using character-to-token heuristic ratios.
- **Module Scope:**
  - _In Scope:_ Core tick execution loops, tracking loop run durations, parsing state transition blocks, and updating terminal indicator displays.
  - _Out of Scope:_ Direct workspace sandbox integrations (to keep the state engine testable, the state transitions are validated via mock interfaces).
- **Dependencies:**
  - _Blocked By:_ [TASK-02], [TASK-10]
  - _Blocks:_ [TASK-12]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock terminal spinner outputs and establish low loop limits (e.g., maximum 2 loops). Provide a mock executor that returns intermediate steps.
  - _Test Execution & Assertion:_ Run `AgenticLoopStateMachine.executeLoop("task-gamma", "Build module")`. Verify that when execution passes configured iteration thresholds, the loop halts and returns a status payload reflecting a failure state due to loop count exhaustion.

---

#### [TASK-12]: AgenticLoopStateMachine Integration & Workspace Coordination

- **Description:** Connect `AgenticLoopStateMachine` with `WorkspaceSandboxExecutor` and `LLMOrchestrator`. Implement the complete autonomous execution lifecycle, translating suggested LLM actions into filesystem edits or test verifications, managing token threshold pruning alerts, and cleaning up sandbox branches on interrupts (SIGINT) or failures.
- **Module Scope:**
  - _In Scope:_ Full end-to-end coordinating states, event triggers, context-pruning conditions, SIGINT signal handling, and workspace teardown actions.
  - _Out of Scope:_ Arbitrary terminal shell access or writing custom filesystem changes outside of the configured patching tools.
- **Dependencies:**
  - _Blocked By:_ [TASK-08], [TASK-11]
  - _Blocks:_ None (Final system integration task)
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock the LLM orchestrator to suggest a patch change and a subsequent verification command. Mock the workspace executor to simulate successful operations.
  - _Test Execution & Assertion:_ Execute the full state loop. Verify that the system executes the patch, runs the verification suite, commits the changes on success, and returns a `complete` status summary. Simulate a SIGINT event during execution to verify that rollback procedures are executed and the original developer workspace is restored.
