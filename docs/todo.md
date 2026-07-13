## PRD

### TASK 03

#### Refactoring Recommendations:

- Auto-Initialization Helper: Currently, if a caller accesses methods before initializeDatabase() is called, they receive a runtime error. While this is clean and enforces explicit startup sequences, we could make it more permissive by invoking a private synchronization check that calls initializeDatabase on-demand if the database connection instance is not established. However, the current strict design guarantees initialization occurs in a predictable CLI phase, which prevents hidden filesystem side-effects when loading code.
- Statement Caching: If high-performance queries are needed later, prepared statement caching could be implemented to reuse the statements across multiple runs instead of running db.prepare() on every call, though given standard agent execution turn frequencies, the current overhead is negligible.

### TASK 04

#### Refactoring Recommendations:

- Cleanups / Expired Cooldown Maintenance: Currently, the database stores all registered cooldown entries indefinitely. Although LLM provider entries are low-cardinality, we could eventually add an internal maintenance step within initializeDatabase or getRateLimitCooldown to delete past epoch timestamps (i.e. DELETE FROM provider_cooldowns WHERE reset_epoch_ms < ?) to keep the table size strictly minimal.
- Dynamic Database Paths: The constructor gracefully handles custom database paths during testing and delegates default resolution to ConfigManager for production use. This dependency inversion setup correctly keeps the production config logic decoupled from test execution.

### TASK 05

#### Refactoring Recommendations:

- Injection-Free Execution: By utilizing execFile, arguments are passed directly as an array (['rev-parse', '--is-inside-work-tree']) without spawning a shell interpreter. This structurally bypasses traditional command injection vulnerabilities.
- Graceful Error Recovery: Instead of throwing high-level exceptions on system check failures (e.g., when directories do not exist or when Git commands exit with code 128), the validator safely returns false, ensuring that high-level callers can perform conditional environment validations seamlessly.
- Node-Native Performance: No external heavy dependencies (like simple-git) were introduced, keeping the CLI footprint extremely lightweight and fast.

### TASK 06

#### Refactoring Recommendations:

- Command Execution: The use of execFileSync rather than execSync avoids shell execution vulnerabilities and resolves differences in terminal behavior between Windows shells (PowerShell, Command Prompt) and Unix shells (sh, bash).
- Git Status Guard: By checking git status --porcelain before executing git stash push, we avoid unnecessary or empty stash entries while ensuring that repositories with untracked files are correctly and fully cleaned with the -u flag.

### TASK 07

#### Refactoring & Stability Recommendations:

Three stability recommendations can make this module even more robust when running in production:

---

##### 1. Transient Git Lock Retries (Lock File Contention)

**The Problem:**
In modern development environments, background tasks (VS Code Git integrations, automatic linters, or file watchers) can trigger concurrent Git processes. This occasionally results in transient lock errors like:
`fatal: Unable to create '.git/index.lock': File exists.`

**The Recommendation:**
Introduce a lightweight retry wrapper for command execution. If a `runGit` command fails with a lock file error, we can catch it, wait 100–200 milliseconds, and retry up to 3 times before finally giving up. This prevents transient crashes in the middle of an autonomous agent loop.

```typescript
// Example Implementation Fragment:
private async runGitWithRetry(args: string[], retries = 3): Promise<string> {
  try {
    return this.runGit(args);
  } catch (error: any) {
    const isLockError = error.message?.includes("index.lock") || error.message?.includes(".lock");
    if (isLockError && retries > 0) {
      await new Promise(resolve => setTimeout(resolve, 150));
      return this.runGitWithRetry(args, retries - 1);
    }
    throw error;
  }
}
```

---

##### 2. Guard Against Missing Git Identity in CI/Isolated Shells

**The Problem:**
If the tool is executed inside an isolated Docker container, a bare-metal CI runner, or a freshly initialized environment without global Git configuration, any attempt by the agent to make a commit on the sandbox branch will fail with:
`*** Please tell me who you are.`

**The Recommendation:**
Before applying changes, the manager can verify if a Git identity is configured. If not, it can temporarily set a repository-local user configuration (`user.name` and `user.email`) restricted strictly to the current workspace, allowing the execution loop to proceed smoothly.

```typescript
// Example Implementation Fragment:
private ensureGitIdentity(): void {
  try {
    this.runGit(["config", "--get", "user.name"]);
  } catch {
    // If name is missing, configure local fallbacks for this repository only
    this.runGit(["config", "local", "user.name", "Nexus CLI Agent"]);
    this.runGit(["config", "local", "user.email", "agent@nexus.local"]);
  }
}
```

---

##### 3. Handle Detached HEAD States

**The Problem:**
If a developer checks out a specific commit hash (detached HEAD state) rather than a branch, and then runs the agent, `findOriginalBranch` will fallback to `"main"`. When restoring, the developer will be switched back to `main` instead of the original commit they were looking at, altering their workspace state.

**The Recommendation:**
If `git branch --show-current` returns an empty string (signifying a detached HEAD) before the sandbox branch is created, we can record the exact commit SHA (via `git rev-parse HEAD`) as the target to return to, rather than assuming a named branch.

---

### TASK 11

#### Refactoring Recommendations

- Model Parameters: In the future (e.g., in TASK-12 or TASK-13), we can support passing extra sampling settings such as temperature or maxTokens during initialization via LLMOrchestratorOptions.
- System Prompt Formatting: As the system architecture matures, we can dynamically compile systemInstruction using environment information (such as active OS, repository metadata, or absolute file paths) to ensure maximum local alignment.

---

### TASK 12

#### Refactoring Recommendations

- Default Backoff Multipliers: If no retry-after header is supplied in consecutive rate limits, consider using an exponential backoff factor (e.g., doubling the default 2000ms backoff with each failure count: 2000 \* Math.pow(2, attempts)). This would prevent hitting severe outer security layers when encountering highly strict APIs.
- Provider Auto-Detection: If providerName is omitted in the constructor options, we could infer it from the model.provider string (provided by most Vercel AI SDK language models) to automate database namespace organization.

---

### TASK 13

#### Refactoring Recommendations

- Parallel Summarization: Using Promise.all allows both clusters of older steps to be summarized concurrently when communicating with the upstream model provider. This avoids sequential network request overhead.
- Copy on Return: By returning copies of the raw steps (slice & array destructuring), we guarantee that modifications made to the returned array in memory do not mutate the history cache out-of-band, preserving strict functional isolation.

---

### TASK 18

#### Refactoring Recommendations

- Shared State Management: If the codebase continues to grow, we can encapsulate loop details (such as stepIndex and sessionId) inside an AgenticSessionContext structure. This would keep method signatures clean and reduce closure dependencies.
- Process Signals abstraction: If other signals need to be handled similarly in the future (e.g. SIGTERM), we can move this listener pattern to an isolated ProcessSignalManager helper to keep the state machine class purely focused on agent execution flow.

---

### TASK 19

#### Refactoring Recommendations (Clean Code Verification)

- Graceful Shell Integration: For production usage, we recommend placing a lightweight wrapper script in a binary entry point (e.g., bin/nexus.js or src/index.ts) that calls runCLI().catch(...) and exits the process with code 1 upon uncaught errors, keeping the core testable runCLI free of rigid process.exit() calls that would disrupt test runners.
- Unified Step Limit Propagation: The CLI config parses agent.config.json limits during bootstrap. In a future task, we could load the parsed stepLimit from the local ConfigManager workspace configuration and pass it automatically into options.stepLimit inside the runCLI execution branch to seamlessly link user preferences to the active loop boundaries.

### Recommended Next Steps

To make the application fully interactive, we should:

- Implement the default LanguageModel resolver (such as reading API keys from ~/.config/nexus/.env and using @ai-sdk/openai or similar).
- Create a unified SandboxExecutorImpl class to resolve the Git, Patch, and command execution components into a single object.
- Wire these defaults into src/cli.ts and set up the shebang binary script.

---

## PRD 2

### TASK 02

#### Refactoring Recommendations

- Pre-Caching Config Payload: If getCommandTemplate is frequently queried, the configuration JSON file could be read once and cached in memory. However, since the PRD treats modifications as potentially dynamic (matching transactional sessions), reading the file fresh ensures we always pick up configuration modifications made on-disk, maintaining high session reliability. Given the CLI context, the disk access overhead is negligible.

---

### TASK 05

#### Refactoring Recommendations

- Execution abstracting: If we want to fully separate Git executions from low-level child-process implementations, we could later introduce a simple GitExecutor helper interface. This would prevent test files from having to mock standard library components like node:child_process directly and would simplify mocking. However, the current setup is highly clean and works perfectly without introducing extra abstractions.

---

### TASK 06

#### Refactoring Recommendations

The current implementation is robust and conforms to all functional requirements. To enhance future maintainability, we can suggest the following minor, non-breaking refactoring paths:

- Deterministic Stash Parsing:
  The findOriginalBranch and popStashForTask methods currently match the task ID strictly using regexes over the text registers of git outputs. If needed, the taskId parameter format can be sanitized or validated to confirm it does not contain shell-breaking metadata, though shell-less process spawning (execFileSync) already mitigates standard process injection vectors.
- Logging Interceptor:
  For debugging execution flows in dry run situations, we could introduce an optional logger interface into SandboxBranchManagerOptions. This would allow logging the checked-out branch, the stashed changesets, and git cleanup steps without impacting the core production logging behavior.

---

### TASK 09

#### Refactoring Recommendations

Should you wish to refine this module further, we recommend the following additive adjustment:

- **Consolidate Rate-Limiting & Retry Logic:** The rate-limiting checks and exponential backoff/cooldown mechanisms are currently duplicated across both overload paths. We could extract this wrapper logic into a private helper method within `VercelLLMOrchestrator`:
  ```typescript
  private async executeWithRetryAndCooldown<T>(
    apiCall: () => Promise<T>
  ): Promise<T | { error: string }>
  ```
  This extraction would reduce duplicate code while keeping the public interface signature identical.
