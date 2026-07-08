import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { SandboxBranchManager } from "./SandboxBranchManager.js";

// Intercept child_process for ESM-safe mocking on isolated tests
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: (file: string, args: string[], options: any) => {
      const customMock = (globalThis as any).__mockExecFileSync;
      if (customMock) {
        return customMock(file, args, options);
      }
      return actual.execFileSync(file, args, options);
    },
  };
});

describe("SandboxBranchManager - Isolated Mock Tests", () => {
  beforeEach(() => {
    (globalThis as any).__mockExecFileSync = undefined;
  });

  afterEach(() => {
    (globalThis as any).__mockExecFileSync = undefined;
  });

  it("should execute correct sequential Git commands for applySandboxBranch", async () => {
    const executedCalls: Array<{ file: string; args: string[]; options: any }> =
      [];

    // Define the mock behavior specifically for this isolated test
    (globalThis as any).__mockExecFileSync = (
      file: string,
      args: string[],
      options: any,
    ) => {
      executedCalls.push({ file, args, options });
      if (args[0] === "status") {
        return "M src/file.ts\n";
      }
      return "";
    };

    const manager = new SandboxBranchManager({ workingDir: "/mock/repo" });
    await manager.applySandboxBranch("task-alpha");

    // Verify exactly 4 Git commands are called
    expect(executedCalls).toHaveLength(4);

    // Call 1: Check work tree
    expect(executedCalls[0]).toEqual({
      file: "git",
      args: ["rev-parse", "--is-inside-work-tree"],
      options: { cwd: "/mock/repo", stdio: "ignore" },
    });

    // Call 2: Status check
    expect(executedCalls[1]).toEqual({
      file: "git",
      args: ["status", "--porcelain"],
      options: { cwd: "/mock/repo", encoding: "utf8", stdio: "pipe" },
    });

    // Call 3: Stash dirty workspace
    expect(executedCalls[2]).toEqual({
      file: "git",
      args: ["stash", "push", "-u", "-m", "nexus-backup: task-alpha"],
      options: { cwd: "/mock/repo", encoding: "utf8", stdio: "pipe" },
    });

    // Call 4: Checkout target branch
    expect(executedCalls[3]).toEqual({
      file: "git",
      args: ["checkout", "-b", "agent/task-alpha"],
      options: { cwd: "/mock/repo", encoding: "utf8", stdio: "pipe" },
    });
  });

  it("should execute correct sequential Git commands for restoreOriginalBranch (Unit Test Setup)", async () => {
    const executedCalls: Array<{ file: string; args: string[]; options: any }> =
      [];

    (globalThis as any).__mockExecFileSync = (
      file: string,
      args: string[],
      options: any,
    ) => {
      executedCalls.push({ file, args, options });

      if (args[0] === "branch" && args[1] === "--list") {
        return "agent/task-alpha"; // Sandbox branch exists
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        return "agent/task-alpha"; // We are on the sandbox branch
      }
      if (args[0] === "reflog") {
        return "1a2b3c4 HEAD@{0}: checkout: moving from main to agent/task-alpha";
      }
      if (args[0] === "stash" && args[1] === "list") {
        return "stash@{0}: WIP on main: nexus-backup: task-alpha";
      }
      return "";
    };

    const manager = new SandboxBranchManager({ workingDir: "/mock/repo" });
    await manager.restoreOriginalBranch("task-alpha");

    // Verify sequential operations:
    // 1. check sandbox branch exists: branch --list agent/task-alpha
    expect(executedCalls[0].args).toEqual([
      "branch",
      "--list",
      "agent/task-alpha",
    ]);
    // 2. get reflog to find original branch: reflog -n 100
    expect(executedCalls[1].args).toEqual(["reflog", "-n", "100"]);
    // 3. get current branch: branch --show-current
    expect(executedCalls[2].args).toEqual(["branch", "--show-current"]);
    // 4. reset hard to HEAD: reset --hard HEAD
    expect(executedCalls[3].args).toEqual(["reset", "--hard", "HEAD"]);
    // 5. clean untracked files: clean -fd
    expect(executedCalls[4].args).toEqual(["clean", "-fd"]);
    // 6. checkout original branch: checkout main
    expect(executedCalls[5].args).toEqual(["checkout", "main"]);
    // 7. delete sandbox branch: branch -D agent/task-alpha
    expect(executedCalls[6].args).toEqual(["branch", "-D", "agent/task-alpha"]);
    // 8. list stashes: stash list
    expect(executedCalls[7].args).toEqual(["stash", "list"]);
    // 9. pop correct stash entry: stash pop stash@{0}
    expect(executedCalls[8].args).toEqual(["stash", "pop", "stash@{0}"]);
  });

  it("should execute correct sequential Git commands for mergeSandboxBranch (Unit Test Setup)", async () => {
    const executedCalls: Array<{ file: string; args: string[]; options: any }> =
      [];

    (globalThis as any).__mockExecFileSync = (
      file: string,
      args: string[],
      options: any,
    ) => {
      executedCalls.push({ file, args, options });

      if (args[0] === "branch" && args[1] === "--list") {
        return "agent/task-alpha";
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        return "agent/task-alpha";
      }
      if (args[0] === "reflog") {
        return "1a2b3c4 HEAD@{0}: checkout: moving from main to agent/task-alpha";
      }
      if (args[0] === "stash" && args[1] === "list") {
        return "stash@{0}: WIP on main: nexus-backup: task-alpha";
      }
      return "";
    };

    const manager = new SandboxBranchManager({ workingDir: "/mock/repo" });
    await manager.mergeSandboxBranch("task-alpha");

    // Verify sequential operations:
    // 1. check sandbox branch exists: branch --list agent/task-alpha
    expect(executedCalls[0].args).toEqual([
      "branch",
      "--list",
      "agent/task-alpha",
    ]);
    // 2. get reflog to find original branch: reflog -n 100
    expect(executedCalls[1].args).toEqual(["reflog", "-n", "100"]);
    // 3. get current branch: branch --show-current
    expect(executedCalls[2].args).toEqual(["branch", "--show-current"]);
    // 4. checkout original branch: checkout main
    expect(executedCalls[3].args).toEqual(["checkout", "main"]);
    // 5. merge with fast-forward: merge --ff-only agent/task-alpha
    expect(executedCalls[4].args).toEqual([
      "merge",
      "--ff-only",
      "agent/task-alpha",
    ]);
    // 6. delete sandbox branch: branch -D agent/task-alpha
    expect(executedCalls[5].args).toEqual(["branch", "-D", "agent/task-alpha"]);
    // 7. list stashes: stash list
    expect(executedCalls[6].args).toEqual(["stash", "list"]);
    // 8. pop correct stash entry: stash pop stash@{0}
    expect(executedCalls[7].args).toEqual(["stash", "pop", "stash@{0}"]);
  });
});

describe("SandboxBranchManager", () => {
  let tempRepoPath: string;

  function runGit(args: string[]): string {
    return execFileSync("git", args, {
      cwd: tempRepoPath,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  }

  beforeEach(async () => {
    tempRepoPath = await mkdtemp(join(tmpdir(), "nexus-sandbox-test-"));
  });

  afterEach(async () => {
    try {
      await rm(tempRepoPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  const setupGitRepo = async () => {
    runGit(["init"]);
    runGit(["config", "user.name", "Test User"]);
    runGit(["config", "user.email", "test@example.com"]);
    runGit(["checkout", "-b", "main"]);

    const initialFile = join(tempRepoPath, "README.md");
    await writeFile(initialFile, "# Test Project\nInitial content.");
    runGit(["add", "README.md"]);
    runGit(["commit", "-m", "Initial commit"]);
  };

  it("should fail if the target directory is not a Git repository", async () => {
    const manager = new SandboxBranchManager({ workingDir: tempRepoPath });

    await expect(manager.applySandboxBranch("task-uuid-123")).rejects.toThrow(
      /not a valid Git repository/,
    );
  });

  it("should successfully stash modifications and checkout a new agent/[task-uuid] branch", async () => {
    await setupGitRepo();

    const initialBranch = runGit(["branch", "--show-current"]);
    expect(initialBranch).toBe("main");

    const trackedFile = join(tempRepoPath, "README.md");
    await writeFile(trackedFile, "# Test Project\nModified content.");

    const manager = new SandboxBranchManager({ workingDir: tempRepoPath });
    await manager.applySandboxBranch("task-uuid-456");

    const currentBranch = runGit(["branch", "--show-current"]);
    expect(currentBranch).toBe("agent/task-uuid-456");

    const status = runGit(["status", "--porcelain"]);
    expect(status).toBe("");

    const stashList = runGit(["stash", "list"]);
    expect(stashList).toContain("nexus-backup: task-uuid-456");
  });

  it("should still succeed and branch if there are no uncommitted modifications", async () => {
    await setupGitRepo();

    const manager = new SandboxBranchManager({ workingDir: tempRepoPath });
    await manager.applySandboxBranch("task-uuid-789");

    const currentBranch = runGit(["branch", "--show-current"]);
    expect(currentBranch).toBe("agent/task-uuid-789");

    const status = runGit(["status", "--porcelain"]);
    expect(status).toBe("");
  });

  /* --- NEW TESTS FOR TASK-07: RECOVERY & MERGING --- */

  it("should successfully merge sandbox branch and restore stashed modifications", async () => {
    await setupGitRepo();

    const manager = new SandboxBranchManager({ workingDir: tempRepoPath });

    const localChangeFile = join(tempRepoPath, "local-work.txt");
    await writeFile(localChangeFile, "my local modifications");

    const taskId = "task-merge-111";
    await manager.applySandboxBranch(taskId);

    const agentFile = join(tempRepoPath, "agent-output.txt");
    await writeFile(agentFile, "agent work completed successfully");
    runGit(["add", "agent-output.txt"]);
    runGit(["commit", "-m", "Agent: Completed task-merge-111"]);

    await manager.mergeSandboxBranch(taskId);

    const currentBranch = runGit(["branch", "--show-current"]);
    expect(currentBranch).toBe("main");

    const branches = runGit(["branch"]);
    expect(branches).not.toContain(`agent/${taskId}`);

    const agentFileContent = await readFile(agentFile, "utf8");
    expect(agentFileContent).toBe("agent work completed successfully");

    const localContent = await readFile(localChangeFile, "utf8");
    expect(localContent).toBe("my local modifications");

    const stashList = runGit(["stash", "list"]);
    expect(stashList).not.toContain(`nexus-backup: ${taskId}`);
  });

  it("should successfully restore original branch and discard sandbox changes", async () => {
    await setupGitRepo();

    const manager = new SandboxBranchManager({ workingDir: tempRepoPath });

    const localChangeFile = join(tempRepoPath, "local-work.txt");
    await writeFile(localChangeFile, "my local modifications");

    const taskId = "task-restore-222";
    await manager.applySandboxBranch(taskId);

    const agentFile = join(tempRepoPath, "agent-work-failed.txt");
    await writeFile(agentFile, "failed experimental work");
    runGit(["add", "agent-work-failed.txt"]);
    runGit(["commit", "-m", "Agent: Failed experiment"]);

    await manager.restoreOriginalBranch(taskId);

    const currentBranch = runGit(["branch", "--show-current"]);
    expect(currentBranch).toBe("main");

    const branches = runGit(["branch"]);
    expect(branches).not.toContain(`agent/${taskId}`);

    const agentFileExists = await readFile(agentFile, "utf8")
      .then(() => true)
      .catch(() => false);
    expect(agentFileExists).toBe(false);

    const localContent = await readFile(localChangeFile, "utf8");
    expect(localContent).toBe("my local modifications");

    const stashList = runGit(["stash", "list"]);
    expect(stashList).not.toContain(`nexus-backup: ${taskId}`);
  });

  it("should handle stash conflicts gracefully without losing the stash", async () => {
    await setupGitRepo();

    const manager = new SandboxBranchManager({ workingDir: tempRepoPath });

    const filePath = join(tempRepoPath, "README.md");

    await writeFile(
      filePath,
      "# Test Project\nInitial content.\nUser local change.",
    );

    const taskId = "task-conflict-333";
    await manager.applySandboxBranch(taskId);

    await writeFile(
      filePath,
      "# Test Project\nInitial content.\nAgent conflicting change.",
    );
    runGit(["add", "README.md"]);
    runGit(["commit", "-m", "Agent: Conflicting change"]);

    await expect(manager.mergeSandboxBranch(taskId)).rejects.toThrow(
      /Stash pop resulted in a merge conflict/,
    );

    const stashList = runGit(["stash", "list"]);
    expect(stashList).toContain(`nexus-backup: ${taskId}`);

    const fileContent = await readFile(filePath, "utf8");
    expect(fileContent).toContain("<<<<<<<");
    expect(fileContent).toContain("=======");
    expect(fileContent).toContain(">>>>>>>");
  });

  it("should be idempotent when calling restoreOriginalBranch multiple times", async () => {
    await setupGitRepo();

    const manager = new SandboxBranchManager({ workingDir: tempRepoPath });

    const localChangeFile = join(tempRepoPath, "local-work.txt");
    await writeFile(localChangeFile, "my local modifications");

    const taskId = "task-idempotent-restore";
    await manager.applySandboxBranch(taskId);

    await manager.restoreOriginalBranch(taskId);

    const currentBranch = runGit(["branch", "--show-current"]);
    expect(currentBranch).toBe("main");
    expect(await readFile(localChangeFile, "utf8")).toBe(
      "my local modifications",
    );

    await expect(manager.restoreOriginalBranch(taskId)).resolves.not.toThrow();
  });

  it("should be idempotent when calling mergeSandboxBranch multiple times", async () => {
    await setupGitRepo();

    const manager = new SandboxBranchManager({ workingDir: tempRepoPath });

    const localChangeFile = join(tempRepoPath, "local-work.txt");
    await writeFile(localChangeFile, "my local modifications");

    const taskId = "task-idempotent-merge";
    await manager.applySandboxBranch(taskId);

    const agentFile = join(tempRepoPath, "agent-output.txt");
    await writeFile(agentFile, "completed work");
    runGit(["add", "agent-output.txt"]);
    runGit(["commit", "-m", "Agent: Completed work"]);

    await manager.mergeSandboxBranch(taskId);

    expect(runGit(["branch", "--show-current"])).toBe("main");
    expect(await readFile(agentFile, "utf8")).toBe("completed work");
    expect(await readFile(localChangeFile, "utf8")).toBe(
      "my local modifications",
    );

    await expect(manager.mergeSandboxBranch(taskId)).resolves.not.toThrow();
  });
});
