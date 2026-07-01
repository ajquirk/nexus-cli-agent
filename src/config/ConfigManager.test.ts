import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ConfigManager } from "./ConfigManager.js";

describe("ConfigManager [TASK-01]", () => {
  let tempHomeDir: string;
  let tempWorkspaceDir: string;

  beforeEach(() => {
    // Isolate tests by creating unique temp directories for HOME and workspace root
    tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-test-home-"));
    tempWorkspaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nexus-test-workspace-"),
    );
  });

  afterEach(() => {
    // Clean up temporary files and directories after each test run
    if (fs.existsSync(tempHomeDir)) {
      fs.rmSync(tempHomeDir, { recursive: true, force: true });
    }
    if (fs.existsSync(tempWorkspaceDir)) {
      fs.rmSync(tempWorkspaceDir, { recursive: true, force: true });
    }
  });

  it("should construct with paths and resolve correct sub-paths", () => {
    const manager = new ConfigManager({
      homeDir: tempHomeDir,
      workspaceDir: tempWorkspaceDir,
    });

    const expectedConfigDir = path.join(tempHomeDir, ".config", "nexus");
    expect(manager.getNexusConfigDir()).toBe(expectedConfigDir);
    expect(manager.getEnvFilePath()).toBe(path.join(expectedConfigDir, ".env"));
    expect(manager.getWorkspaceConfigPath()).toBe(
      path.join(tempWorkspaceDir, "agent.config.json"),
    );
  });

  it("should initialize configuration directory, credentials file, and workspace config template", async () => {
    const manager = new ConfigManager({
      homeDir: tempHomeDir,
      workspaceDir: tempWorkspaceDir,
    });

    await manager.initializeConfig();

    const configDir = manager.getNexusConfigDir();
    const envFile = manager.getEnvFilePath();
    const workspaceConfigFile = manager.getWorkspaceConfigPath();

    // 1. Assert Nexus config directory creation
    expect(fs.existsSync(configDir)).toBe(true);

    // 2. Assert permissions of ~/.config/nexus/ are 0600 on supporting platforms
    if (process.platform !== "win32") {
      const stats = fs.statSync(configDir);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    }

    // 3. Assert credentials file exists
    expect(fs.existsSync(envFile)).toBe(true);

    // 4. Assert workspace config template was generated in current working directory
    expect(fs.existsSync(workspaceConfigFile)).toBe(true);

    // 5. Assert template contains default settings (e.g., limits.stepLimit)
    const configContent = JSON.parse(
      fs.readFileSync(workspaceConfigFile, "utf-8"),
    );
    expect(configContent).toHaveProperty("limits");
    expect(configContent.limits).toHaveProperty("stepLimit");
    expect(typeof configContent.limits.stepLimit).toBe("number");
  });

  it("should be idempotent and not overwrite pre-existing files", async () => {
    const manager = new ConfigManager({
      homeDir: tempHomeDir,
      workspaceDir: tempWorkspaceDir,
    });

    // Run first initialization
    await manager.initializeConfig();

    const envFile = manager.getEnvFilePath();
    const workspaceConfigFile = manager.getWorkspaceConfigPath();

    // Populate with custom user content
    const customSecret = "NEXUS_API_KEY=my-super-secret-key";
    fs.writeFileSync(envFile, customSecret, "utf-8");

    const customConfig = { limits: { stepLimit: 999 } };
    fs.writeFileSync(
      workspaceConfigFile,
      JSON.stringify(customConfig),
      "utf-8",
    );

    // Run initialization again
    await manager.initializeConfig();

    // Assert files were NOT overwritten with defaults
    const envContent = fs.readFileSync(envFile, "utf-8").trim();
    expect(envContent).toBe(customSecret);

    const configContent = JSON.parse(
      fs.readFileSync(workspaceConfigFile, "utf-8"),
    );
    expect(configContent.limits.stepLimit).toBe(999);
  });
});
