import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { SandboxBranchManager } from "./SandboxBranchManager.js";

describe("SandboxBranchManager", () => {
  let tempRepoPath: string;

  // Robust argument helper to run git commands in our test repository without shell quoting issues
  function runGit(args: string[]): string {
    return execFileSync("git", args, {
      cwd: tempRepoPath,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  }

  beforeEach(async () => {
    // Create a unique temporary directory for each test run
    tempRepoPath = await mkdtemp(join(tmpdir(), "nexus-sandbox-test-"));
  });

  afterEach(async () => {
    // Cleanup temporary directories
    try {
      await rm(tempRepoPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  const setupGitRepo = async () => {
    // Initialize repository and set user config local to the repository
    runGit(["init"]);
    runGit(["config", "user.name", "Test User"]);
    runGit(["config", "user.email", "test@example.com"]);

    // Explicitly checkout 'main' branch
    runGit(["checkout", "-b", "main"]);

    // Create an initial commit so we have a valid HEAD
    const initialFile = join(tempRepoPath, "README.md");
    await writeFile(initialFile, "# Test Project\nInitial content.");
    runGit(["add", "README.md"]);
    runGit(["commit", "-m", "Initial commit"]);
  };

  it("should fail if the target directory is not a Git repository", async () => {
    const manager = new SandboxBranchManager({ workingDir: tempRepoPath });

    // Attempting to apply a sandbox branch on an uninitialized directory should throw
    await expect(manager.applySandboxBranch("task-uuid-123")).rejects.toThrow(
      /not a valid Git repository/,
    );
  });

  it("should successfully stash modifications and checkout a new agent/[task-uuid] branch", async () => {
    await setupGitRepo();

    // Verify we are starting on the 'main' branch
    const initialBranch = runGit(["branch", "--show-current"]);
    expect(initialBranch).toBe("main");

    // Create an uncommitted file modification (dirty workspace)
    const trackedFile = join(tempRepoPath, "README.md");
    await writeFile(trackedFile, "# Test Project\nModified content.");

    const manager = new SandboxBranchManager({ workingDir: tempRepoPath });
    await manager.applySandboxBranch("task-uuid-456");

    // 1. Assert that the active working branch becomes agent/task-uuid-456
    const currentBranch = runGit(["branch", "--show-current"]);
    expect(currentBranch).toBe("agent/task-uuid-456");

    // 2. Assert that git status reports a clean working tree
    const status = runGit(["status", "--porcelain"]);
    expect(status).toBe("");

    // 3. Verify that the stash actually contains our uncommitted change
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
});
