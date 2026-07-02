import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { GitValidator } from "./GitValidator.js";

describe("GitValidator Integration Tests", () => {
  let tempBaseDir: string;
  let gitRepoPath: string;
  let nonGitRepoPath: string;
  let nonExistentPath: string;

  const validator = new GitValidator();

  beforeAll(async () => {
    // Generate a secure, isolated temporary directory in the OS temp space
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-git-test-"));

    gitRepoPath = path.join(tempBaseDir, "git-repo-test");
    nonGitRepoPath = path.join(tempBaseDir, "non-git-repo-test");
    nonExistentPath = path.join(tempBaseDir, "does-not-exist-dir");

    // Create target folders
    await fs.mkdir(gitRepoPath, { recursive: true });
    await fs.mkdir(nonGitRepoPath, { recursive: true });

    // Initialize Git in gitRepoPath
    try {
      execSync("git init", { cwd: gitRepoPath, stdio: "ignore" });
    } catch (error) {
      console.warn(
        "Failed to initialize mock git directory in test setup:",
        error,
      );
    }
  });

  afterAll(async () => {
    // Clean up temporary workspace structures
    if (tempBaseDir) {
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    }
  });

  it("should return true when pointing to a valid Git repository workspace", async () => {
    const isGit = await validator.isGitRepository(gitRepoPath);
    expect(isGit).toBe(true);
  });

  it("should return false when pointing to a standard non-Git workspace directory", async () => {
    const isGit = await validator.isGitRepository(nonGitRepoPath);
    expect(isGit).toBe(false);
  });

  it("should return false and handle gracefully when directory path does not exist", async () => {
    const isGit = await validator.isGitRepository(nonExistentPath);
    expect(isGit).toBe(false);
  });
});
