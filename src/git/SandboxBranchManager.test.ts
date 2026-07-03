import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { SandboxBranchManager } from "./SandboxBranchManager.js";

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

    // 1. Create a dirty file in the repository to simulate local changes
    const localChangeFile = join(tempRepoPath, "local-work.txt");
    await writeFile(localChangeFile, "my local modifications");

    // 2. Start sandbox branch
    const taskId = "task-merge-111";
    await manager.applySandboxBranch(taskId);

    // 3. Simulate agent making a successful edit and committing it
    const agentFile = join(tempRepoPath, "agent-output.txt");
    await writeFile(agentFile, "agent work completed successfully");
    runGit(["add", "agent-output.txt"]);
    runGit(["commit", "-m", "Agent: Completed task-merge-111"]);

    // 4. Execute the merge routine
    await manager.mergeSandboxBranch(taskId);

    // 5. Assert: branch is back to 'main'
    const currentBranch = runGit(["branch", "--show-current"]);
    expect(currentBranch).toBe("main");

    // 6. Assert: sandbox branch agent/task-merge-111 is deleted
    const branches = runGit(["branch"]);
    expect(branches).not.toContain(`agent/${taskId}`);

    // 7. Assert: agent work is successfully merged and present on main
    const agentFileContent = await readFile(agentFile, "utf8");
    expect(agentFileContent).toBe("agent work completed successfully");

    // 8. Assert: local stashed work has been successfully popped and restored
    const localContent = await readFile(localChangeFile, "utf8");
    expect(localContent).toBe("my local modifications");

    // 9. Assert: backup stash for this task was cleared
    const stashList = runGit(["stash", "list"]);
    expect(stashList).not.toContain(`nexus-backup: ${taskId}`);
  });

  it("should successfully restore original branch and discard sandbox changes", async () => {
    await setupGitRepo();

    const manager = new SandboxBranchManager({ workingDir: tempRepoPath });

    // 1. Create local uncommitted work
    const localChangeFile = join(tempRepoPath, "local-work.txt");
    await writeFile(localChangeFile, "my local modifications");

    // 2. Start sandbox branch
    const taskId = "task-restore-222";
    await manager.applySandboxBranch(taskId);

    // 3. Simulate agent edits and committing
    const agentFile = join(tempRepoPath, "agent-work-failed.txt");
    await writeFile(agentFile, "failed experimental work");
    runGit(["add", "agent-work-failed.txt"]);
    runGit(["commit", "-m", "Agent: Failed experiment"]);

    // 4. Execute restore routine to discard changes
    await manager.restoreOriginalBranch(taskId);

    // 5. Assert: branch is back to 'main'
    const currentBranch = runGit(["branch", "--show-current"]);
    expect(currentBranch).toBe("main");

    // 6. Assert: sandbox branch is deleted
    const branches = runGit(["branch"]);
    expect(branches).not.toContain(`agent/${taskId}`);

    // 7. Assert: experimental changes are absent from main branch
    const agentFileExists = await readFile(agentFile, "utf8")
      .then(() => true)
      .catch(() => false);
    expect(agentFileExists).toBe(false);

    // 8. Assert: original uncommitted changes are restored
    const localContent = await readFile(localChangeFile, "utf8");
    expect(localContent).toBe("my local modifications");

    // 9. Assert: backup stash was cleared
    const stashList = runGit(["stash", "list"]);
    expect(stashList).not.toContain(`nexus-backup: ${taskId}`);
  });

  it("should handle stash conflicts gracefully without losing the stash", async () => {
    await setupGitRepo();

    const manager = new SandboxBranchManager({ workingDir: tempRepoPath });

    // 1. Write an initial file and commit it (already done in setupGitRepo, README.md has "Initial content.")
    const filePath = join(tempRepoPath, "README.md");

    // 2. Create a local uncommitted modification on line 2
    await writeFile(
      filePath,
      "# Test Project\nInitial content.\nUser local change.",
    );

    // 3. Apply sandbox branch (this stashes the local change)
    const taskId = "task-conflict-333";
    await manager.applySandboxBranch(taskId);

    // 4. On the sandbox branch, write a conflicting change on line 2 and commit it
    await writeFile(
      filePath,
      "# Test Project\nInitial content.\nAgent conflicting change.",
    );
    runGit(["add", "README.md"]);
    runGit(["commit", "-m", "Agent: Conflicting change"]);

    // 5. Attempt to merge. This should fail because popping the stash conflicts with the agent's commit
    await expect(manager.mergeSandboxBranch(taskId)).rejects.toThrow(
      /Stash pop resulted in a merge conflict/,
    );

    // 6. Verify that the stash was NOT dropped/lost because of the conflict (standard Git safety)
    const stashList = runGit(["stash", "list"]);
    expect(stashList).toContain(`nexus-backup: ${taskId}`);

    // 7. Verify conflict markers exist in the working directory file
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

    // Call restore the first time
    await manager.restoreOriginalBranch(taskId);

    // Assert the branch has reverted and stash is popped
    const currentBranch = runGit(["branch", "--show-current"]);
    expect(currentBranch).toBe("main");
    expect(await readFile(localChangeFile, "utf8")).toBe(
      "my local modifications",
    );

    // Call restore a second time (should be a graceful no-op)
    await expect(manager.restoreOriginalBranch(taskId)).resolves.not.toThrow();
  });

  it("should be idempotent when calling mergeSandboxBranch multiple times", async () => {
    await setupGitRepo();

    const manager = new SandboxBranchManager({ workingDir: tempRepoPath });

    const localChangeFile = join(tempRepoPath, "local-work.txt");
    await writeFile(localChangeFile, "my local modifications");

    const taskId = "task-idempotent-merge";
    await manager.applySandboxBranch(taskId);

    // Simulate an agent commit
    const agentFile = join(tempRepoPath, "agent-output.txt");
    await writeFile(agentFile, "completed work");
    runGit(["add", "agent-output.txt"]);
    runGit(["commit", "-m", "Agent: Completed work"]);

    // Call merge the first time
    await manager.mergeSandboxBranch(taskId);

    // Assert branch is back to main, agent work is merged, local changes popped
    expect(runGit(["branch", "--show-current"])).toBe("main");
    expect(await readFile(agentFile, "utf8")).toBe("completed work");
    expect(await readFile(localChangeFile, "utf8")).toBe(
      "my local modifications",
    );

    // Call merge a second time (should be a graceful no-op)
    await expect(manager.mergeSandboxBranch(taskId)).resolves.not.toThrow();
  });
});
