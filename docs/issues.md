### Part 1: Dependency Graph (Text-Based)

```text
Phase 1: Persistence & Config
  TASK-01 (DB Init) ─────────────> TASK-02 (Message CRUD)
  TASK-03 (Config JSON) ─────────> TASK-04 (.agentrules / REQ-02)
                            └────> TASK-05 (Env Snapshot / REQ-03)

Phase 2: Terminal UI & Interrupts
  TASK-06 (Display UI) ──────────> TASK-07 (Interactive Prompts)
  TASK-08 (Interrupts / REQ-05)

Phase 3: Tool Execution Core & Security
  TASK-09 (Path Validation) ─────> TASK-11 (Abstract Tools & Registry)
  TASK-10 (Truncation / REQ-04) ─┘

Phase 4: Tool Implementations (Requires TASK-11)
  TASK-11 ─┬─> TASK-12 (Safe Tools: list, read, search) [Requires TASK-09]
           ├─> TASK-13 (Action Tool: write_file) [Requires TASK-09]
           ├─> TASK-14 (Action Tool: patch_file) [Requires TASK-09]
           └─> TASK-15 (Action Tool: run_command) [Requires TASK-10]

Phase 5: Agentic Loop Orchestration
  TASK-02, TASK-07 ──────────────> TASK-16 (Session Recovery / REQ-01)
  TASK-04, TASK-05 ──────────────> TASK-17 (System Prompt Assembly)
  TASK-07, TASK-11 ──────────────> TASK-18 (Action Consent Barrier / REQ-06)
  TASK-12 thru 18, TASK-08 ──────> TASK-19 (Core Agentic Loop Cycle)
```

---

### Part 2: Chronological Task Cards

#### [TASK-01]: SessionStore - DB Initialization & Schema Migrations

- **Description:** Initialize `better-sqlite3` and create the foundational table structures for persistent storage. If the local `~/.my-agent/chats.db` does not exist or lacks tables, it must automatically create the `conversations` and `messages` tables.
- **Module Scope:** `SessionStore` class. _Out of scope:_ CRUD logic for reading or writing actual message data.
- **Dependencies:**
  - _Blocked By:_ None
  - _Blocks:_ [TASK-02]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Instantiate `SessionStore` with an in-memory or temporary file database path.
  - _Test Execution & Assertion:_ Execute the constructor. Query the SQLite master table for `conversations` and `messages`. Assert both tables exist and contain the correct columns (id, title, role, content, etc.).

---

#### [TASK-02]: SessionStore - Conversation & Message CRUD Operations

- **Description:** Implement the persistence API to fetch past conversations, create new conversation stubs, save single messages, and retrieve chronologically sorted messages for a specific conversation ID.
- **Module Scope:** `SessionStore` class. _Out of scope:_ Orchestrating the actual LLM logic or terminal rendering.
- **Dependencies:**
  - _Blocked By:_ [TASK-01]
  - _Blocks:_ [TASK-16], [TASK-19]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Use a test instance of `SessionStore` with active tables.
  - _Test Execution & Assertion:_ Call `createNewConversation("Test")`, then `saveMessage(...)` twice using the returned ID. Call `getConversationMessages(id)`. Assert the returned array length is 2 and ordered by timestamp.

---

#### [TASK-03]: ConfigManager - Global Configuration Parser

- **Description:** Create the `ConfigManager` to read/write basic user configurations from `~/.my-agent/config.json`. Must provide fallback default values if the file is missing.
- **Module Scope:** `ConfigManager` class. _Out of scope:_ Parsing project-specific rules or environment paths.
- **Dependencies:**
  - _Blocked By:_ None
  - _Blocks:_ [TASK-04], [TASK-05], [TASK-17]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock the `fs.readFileSync` for `~/.my-agent/config.json` to return a JSON string with `{ "defaultModelProvider": "anthropic" }`.
  - _Test Execution & Assertion:_ Call `getConfig()`. Assert the returned object contains `defaultModelProvider: "anthropic"`.

---

#### [TASK-04]: ConfigManager - Project-Specific Rules Ingestion (REQ-02)

- **Description:** Add runtime detection for a `.agentrules` file inside the initialization directory. If found, read its contents so it can be appended to prompt contexts.
- **Module Scope:** `ConfigManager` class. _Out of scope:_ Formatting this string into the LLM system prompt array.
- **Dependencies:**
  - _Blocked By:_ [TASK-03]
  - _Blocks:_ [TASK-17]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Create a mock local directory with a `.agentrules` file containing `"Ensure all tests run using Vitest"`. Mock target directories.
  - _Test Execution & Assertion:_ Execute `ConfigManager.getProjectSpecificRules()`. Assert the output string matches the file contents exactly. Assert that when the file is absent, it returns `null` without throwing an error.

---

#### [TASK-05]: ConfigManager - Environment Snapshot Generation (REQ-03)

- **Description:** Compile a structured textual dataset describing the host OS, active shell, and top-level directory structure, explicitly ignoring `.git` and `node_modules` folders.
- **Module Scope:** `ConfigManager` class. _Out of scope:_ Fetching deep recursive file structures (only top-level is required).
- **Dependencies:**
  - _Blocked By:_ [TASK-03]
  - _Blocks:_ [TASK-17]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Create a mock workspace directory containing directories: `.git/`, `node_modules/`, `src/`, and `package.json`.
  - _Test Execution & Assertion:_ Run `ConfigManager.getEnvironmentSnapshot()`. Assert the returned file list output contains `src/` and `package.json`, and contains no entries containing `.git` or `node_modules`.

---

#### [TASK-06]: TerminalRenderer - Display UI

- **Description:** Build standard terminal output interfaces using `picocolors` and `ora`. Must include banner rendering, spinner start/stop mechanisms, and system/assistant chunk rendering.
- **Module Scope:** `TerminalRenderer` class. _Out of scope:_ Any interactive user input, prompts, or confirmations.
- **Dependencies:**
  - _Blocked By:_ None
  - _Blocks:_ [TASK-07], [TASK-16], [TASK-19]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Spy on `process.stdout.write` and mock `ora`.
  - _Test Execution & Assertion:_ Call `renderSystemMessage("Hello")`. Assert `stdout.write` receives the correctly color-formatted string. Call `startSpinner("test")`, assert `ora` is initialized.

---

#### [TASK-07]: TerminalRenderer - Interactive Prompts

- **Description:** Implement user input features utilizing `readline` and `@clack/prompts` to ask for verification, take open-ended chat input, and render dropdown selections.
- **Module Scope:** `TerminalRenderer` class. _Out of scope:_ Evaluating the business logic of _when_ to ask these prompts.
- **Dependencies:**
  - _Blocked By:_ [TASK-06]
  - _Blocks:_ [TASK-16], [TASK-18], [TASK-19]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock `@clack/prompts` export `confirm` and `select`.
  - _Test Execution & Assertion:_ Call `promptUserConfirmation("Proceed?")`. Simulate a true response from the mock. Assert the method resolves strictly to boolean `true`.

---

#### [TASK-08]: InterruptHandler - Double-Tap Interruption Mechanics (REQ-05)

- **Description:** Implement a system-wide `SIGINT` listener that traps `Ctrl+C`. First signal cancels active streams/tasks; a second signal within 1000ms triggers a clean application exit.
- **Module Scope:** `InterruptHandler` class and `AgenticLoopController` abort bindings.
- **Dependencies:**
  - _Blocked By:_ None
  - _Blocks:_ [TASK-19]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Register a spy on `process.exit`. Instantiate `InterruptHandler`. Mock loop abort handler.
  - _Test Execution & Assertion:_ Programmatically emit a single `SIGINT` event. Wait 200ms and programmatically emit a second `SIGINT`. Verify that on the first signal, `process.exit` is not called and the abort handler is fired. Verify on the second, `process.exit(0)` is called.

---

#### [TASK-09]: ToolRegistry - Workspace Secure Path Resolution Validation

- **Description:** Implement `validateSecurePath(basePath, targetPath)` to ensure that any path operated on by the agent is strictly within the initialized workspace folder boundary, preventing directory traversal root escapes.
- **Module Scope:** Utilities / `ToolRegistry` dependencies.
- **Dependencies:**
  - _Blocked By:_ None
  - _Blocks:_ [TASK-12], [TASK-13], [TASK-14]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Define a basePath like `/workspace/my-app`.
  - _Test Execution & Assertion:_ Pass target `../../etc/passwd`. Assert the function throws an `Access Denied` error. Pass target `src/index.ts`. Assert it successfully resolves to `/workspace/my-app/src/index.ts`.

---

#### [TASK-10]: ToolRegistry - Tool Output Safe Truncation Filter (REQ-04)

- **Description:** Create a string manipulation utility that truncates output streams exceeding 3,000 characters by returning only the first 50 lines, a delimiter, and the last 50 lines.
- **Module Scope:** Utilities / `ToolRegistry` internal formatting logic.
- **Dependencies:**
  - _Blocked By:_ None
  - _Blocks:_ [TASK-11], [TASK-15]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Generate a text payload of 200 lines, exactly 40 chars each (8,000 chars total).
  - _Test Execution & Assertion:_ Pass this payload to the truncation function. Assert the output length is less than 8,000, contains exactly 101 lines, and contains the literal string `[...Output truncated...]` separating the two halves.

---

#### [TASK-11]: ToolRegistry - Abstract Tool Classes & Registry Setup

- **Description:** Define the `BaseSafeTool` and `BaseActionTool` abstract classes and the central `ToolRegistry` to register, look up, and determine the safety classification of tools.
- **Module Scope:** `ToolRegistry` class, `ITool` interface. _Out of scope:_ Implementing the actual file or command operations.
- **Dependencies:**
  - _Blocked By:_ [TASK-10]
  - _Blocks:_ [TASK-12], [TASK-13], [TASK-14], [TASK-15], [TASK-18]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Register a mock class extending `BaseSafeTool` and another extending `BaseActionTool` into the `ToolRegistry`.
  - _Test Execution & Assertion:_ Call `isActionTool("mock_safe")` (assert `false`). Call `isActionTool("mock_action")` (assert `true`).

---

#### [TASK-12]: ToolRegistry - Safe Tools Implementation

- **Description:** Implement `read_file`, `list_directory`, and `search_code` classes inheriting from `BaseSafeTool`. All file operations must use `validateSecurePath`.
- **Module Scope:** Tool concrete implementations. _Out of scope:_ Action tools that modify system state.
- **Dependencies:**
  - _Blocked By:_ [TASK-09], [TASK-11]
  - _Blocks:_ [TASK-19]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Create a dummy file `test.txt` with "hello". Add `read_file` to the registry.
  - _Test Execution & Assertion:_ Call `ToolRegistry.executeTool("read_file", { path: "test.txt" })`. Assert the output payload equals `"hello"`.

---

#### [TASK-13]: ToolRegistry - Action Tool: write_file

- **Description:** Implement the `write_file` tool inheriting from `BaseActionTool` meant for writing full files (<50KB). Enforces workspace boundary via `validateSecurePath`.
- **Module Scope:** Tool concrete implementations.
- **Dependencies:**
  - _Blocked By:_ [TASK-09], [TASK-11]
  - _Blocks:_ [TASK-19]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Initialize a test directory. Register `write_file`.
  - _Test Execution & Assertion:_ Call `executeTool("write_file", { path: "new.ts", content: "console.log('hi')" })`. Assert `new.ts` is physically written to disk with the correct content.

---

#### [TASK-14]: ToolRegistry - Action Tool: patch_file

- **Description:** Implement a hybrid line-by-line patching tool inheriting from `BaseActionTool` designed to modify large files efficiently via a `PatchBlock` array (`find` and `replace`).
- **Module Scope:** Tool concrete implementations.
- **Dependencies:**
  - _Blocked By:_ [TASK-09], [TASK-11]
  - _Blocks:_ [TASK-19]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Seed a file with 10 lines of text. Target a block of lines 4-6 to be replaced.
  - _Test Execution & Assertion:_ Execute `patch_file` providing the `find` string (lines 4-6) and a `replace` string. Assert the target file reflects only the changed block without affecting lines 1-3 or 7-10. Verify it fails if `find` string doesn't match uniquely.

---

#### [TASK-15]: ToolRegistry - Action Tool: run_command

- **Description:** Implement `run_command` inheriting from `BaseActionTool`. Executes child subprocesses using `spawn`. Must apply a 120-second timeout, `CI=true` non-interactive env variable, and pipe outputs through the truncation filter.
- **Module Scope:** Tool concrete implementations. _Out of scope:_ Allowing interactive standard inputs.
- **Dependencies:**
  - _Blocked By:_ [TASK-10], [TASK-11]
  - _Blocks:_ [TASK-19]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Register `run_command`. Mock a Node process executing `node -e 'setTimeout(() => {}, 200000)'`.
  - _Test Execution & Assertion:_ Force an execution of the timeout script but set the tool registry test timeout to `500ms`. Assert that the tool execution resolves with an error denoting "Timeout Limit Reached" and the subprocess PID is killed.

---

#### [TASK-16]: AgenticLoopController - Session Initialization & Recovery (REQ-01)

- **Description:** Parse startup arguments (`--continue` or `resume`). Interface with `SessionStore` to recover the previous session automatically, or prompt via `TerminalRenderer` to pick a session.
- **Module Scope:** `AgenticLoopController.initializeSession()`.
- **Dependencies:**
  - _Blocked By:_ [TASK-02], [TASK-06], [TASK-07]
  - _Blocks:_ [TASK-19]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Seed SQLite DB with 3 historical conversations. Setup mock argument parser with `{ continueLast: true }`.
  - _Test Execution & Assertion:_ Execute `initializeSession({ continueLast: true })`. Assert the returned ID matches the most recent timestamp in DB. Execute with `continueLast: false`, assert `TerminalRenderer.promptUserSelect` is invoked with seeded conversations.

---

#### [TASK-17]: AgenticLoopController - LLM System Prompt Assembly

- **Description:** Compile the static agent prompt, the `Environment Snapshot`, and `Project-Specific Rules` into a unified System Prompt array context that is injected at the start of any conversation.
- **Module Scope:** `AgenticLoopController` context builders. _Out of scope:_ The actual API transmission to the AI provider.
- **Dependencies:**
  - _Blocked By:_ [TASK-03], [TASK-04], [TASK-05]
  - _Blocks:_ [TASK-19]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock `ConfigManager` to return a specific Snapshot string and a valid `.agentrules` string.
  - _Test Execution & Assertion:_ Call the internal prompt builder method. Assert the final string output contains both the top-level directory snapshot text and the exact `.agentrules` directives.

---

#### [TASK-18]: AgenticLoopController - Interactive Consent Barrier (REQ-06)

- **Description:** Build the tool execution coordinator block that suspends the Agentic Loop when evaluating a tool. Must immediately execute if `isActionTool` is false. Must trigger `promptUserConfirmation` if true, safely aborting if denied.
- **Module Scope:** `AgenticLoopController` internal tool callback handlers.
- **Dependencies:**
  - _Blocked By:_ [TASK-07], [TASK-11]
  - _Blocks:_ [TASK-19]
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Spy on `promptUserConfirmation` to return `true`. Mock an LLM SDK tool call object.
  - _Test Execution & Assertion Step A:_ Pass a Safe Tool (`list_directory`). Assert it executes immediately and `promptUserConfirmation` is not called.
  - _Test Execution & Assertion Step B:_ Pass an Action Tool (`write_file`). Assert execution is deferred until `promptUserConfirmation` is invoked and resolves true.

---

#### [TASK-19]: AgenticLoopController - Core Loop Execution Cycle

- **Description:** Combine all prior modules to form the primary continuous state machine `executeCycle`. Handles streaming LLM inference via `@ai-sdk/core`, pipes tool outputs back into context, updates UI spinners, and synchronizes the active message chain to `SessionStore`.
- **Module Scope:** `AgenticLoopController.executeCycle()`.
- **Dependencies:**
  - _Blocked By:_ [TASK-08], [TASK-12], [TASK-13], [TASK-14], [TASK-15], [TASK-16], [TASK-17], [TASK-18]
  - _Blocks:_ None (Final Integration)
- **TDD Verification Spec:**
  - _Unit Test Setup:_ Mock `@ai-sdk/core` `streamText` response. Inject a mock test prompt "List files".
  - _Test Execution & Assertion:_ Call `executeCycle("List files")`. Assert `TerminalRenderer` spinner transitions, the AI stream is consumed, the `list_directory` tool is automatically called, the result is pushed to the context array, and the final conversation is persisted synchronously to `SessionStore`.
