import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
    vi.restoreAllMocks();
  });

  it("should construct with paths and resolve correct sub-paths", () => {
    const manager = new ConfigManager({
      homeDir: tempHomeDir,
      workspaceDir: tempWorkspaceDir,
    });

    const expectedConfigDir = path.join(tempHomeDir, ".config", "nexus");
    expect(manager.getNexusConfigDir()).toBe(expectedConfigDir);
    expect(manager.getConfigDirectoryPath()).toBe(expectedConfigDir);
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

    // 2. Assert permissions of ~/.config/nexus/ are 0o700 on supporting platforms
    if (process.platform !== "win32") {
      const stats = fs.statSync(configDir);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o700);
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

  describe("REQ-01 POSIX Directory Permission Enforcement", () => {
    it("should create directory and invoke chmod 0o700 on POSIX environment", async () => {
      // Mock platform to be POSIX
      const platformSpy = vi
        .spyOn(process, "platform", "get")
        .mockReturnValue("linux");

      // Define isolated mock functions for fs/promises dependencies
      const mockMkdir = vi.fn().mockResolvedValue(undefined);
      const mockChmod = vi.fn().mockResolvedValue(undefined);
      const mockAccess = vi.fn().mockRejectedValue(new Error("ENOENT"));
      const mockWriteFile = vi.fn().mockResolvedValue(undefined);

      const mockFsPromises = {
        access: mockAccess,
        mkdir: mockMkdir,
        chmod: mockChmod,
        writeFile: mockWriteFile,
      };

      const manager = new ConfigManager({
        homeDir: "/home/user",
        workspaceDir: "/workspace",
        fsPromises: mockFsPromises,
      });

      await manager.initializeConfig();

      const expectedConfigDir = path.join("/home/user", ".config", "nexus");

      // Assert that the injected mkdir mock was called with the target config directory
      expect(mockMkdir).toHaveBeenCalledWith(
        expectedConfigDir,
        expect.objectContaining({ recursive: true }),
      );

      // Assert that the injected chmod mock was triggered with user-only permissions (0o700)
      expect(mockChmod).toHaveBeenCalledWith(expectedConfigDir, 0o700);

      platformSpy.mockRestore();
    });

    it("should skip chmod on Windows platforms", async () => {
      // Mock platform to be Windows
      const platformSpy = vi
        .spyOn(process, "platform", "get")
        .mockReturnValue("win32");

      const mockMkdir = vi.fn().mockResolvedValue(undefined);
      const mockChmod = vi.fn().mockResolvedValue(undefined);
      const mockAccess = vi.fn().mockRejectedValue(new Error("ENOENT"));
      const mockWriteFile = vi.fn().mockResolvedValue(undefined);

      const mockFsPromises = {
        access: mockAccess,
        mkdir: mockMkdir,
        chmod: mockChmod,
        writeFile: mockWriteFile,
      };

      const manager = new ConfigManager({
        homeDir: "C:\\Users\\user",
        workspaceDir: "C:\\workspace",
        fsPromises: mockFsPromises,
      });

      await manager.initializeConfig();

      // Assert chmod is bypassed
      expect(mockChmod).not.toHaveBeenCalled();

      platformSpy.mockRestore();
    });
  });
});

describe("ConfigManager [TASK-02] - getCommandTemplate", () => {
  it("should successfully retrieve a command template when configured as a string array at the top level", async () => {
    const mockReadFile = vi.fn().mockResolvedValue(
      JSON.stringify({
        test: ["npm", "run", "test", "--", "{target}"],
      }),
    );

    const manager = new ConfigManager({
      homeDir: "/home/user",
      workspaceDir: "/workspace",
      fsPromises: {
        access: vi.fn(),
        mkdir: vi.fn(),
        writeFile: vi.fn(),
        chmod: vi.fn(),
        readFile: mockReadFile,
      },
    });

    const result = await manager.getCommandTemplate("test");

    expect(result).toEqual(["npm", "run", "test", "--", "{target}"]);
    expect(mockReadFile).toHaveBeenCalledWith(
      path.join("/workspace", "agent.config.json"),
      expect.objectContaining({ encoding: "utf-8" }),
    );
  });

  it("should retrieve a command template nested inside a 'commands' block for robustness", async () => {
    const mockReadFile = vi.fn().mockResolvedValue(
      JSON.stringify({
        commands: {
          test: ["npm", "run", "test", "--", "{target}"],
        },
      }),
    );

    const manager = new ConfigManager({
      homeDir: "/home/user",
      workspaceDir: "/workspace",
      fsPromises: {
        access: vi.fn(),
        mkdir: vi.fn(),
        writeFile: vi.fn(),
        chmod: vi.fn(),
        readFile: mockReadFile,
      },
    });

    const result = await manager.getCommandTemplate("test");
    expect(result).toEqual(["npm", "run", "test", "--", "{target}"]);
  });

  it("should throw an error if the configured template is a raw string instead of string array", async () => {
    const mockReadFile = vi.fn().mockResolvedValue(
      JSON.stringify({
        test: "npm run test -- {target}",
      }),
    );

    const manager = new ConfigManager({
      homeDir: "/home/user",
      workspaceDir: "/workspace",
      fsPromises: {
        access: vi.fn(),
        mkdir: vi.fn(),
        writeFile: vi.fn(),
        chmod: vi.fn(),
        readFile: mockReadFile,
      },
    });

    await expect(manager.getCommandTemplate("test")).rejects.toThrow(
      "Command template 'test' must be defined strictly as an array of strings to prevent shell-injection vulnerabilities.",
    );
  });

  it("should throw an error if the array template contains non-string items", async () => {
    const mockReadFile = vi.fn().mockResolvedValue(
      JSON.stringify({
        test: ["npm", "run", "test", 123],
      }),
    );

    const manager = new ConfigManager({
      homeDir: "/home/user",
      workspaceDir: "/workspace",
      fsPromises: {
        access: vi.fn(),
        mkdir: vi.fn(),
        writeFile: vi.fn(),
        chmod: vi.fn(),
        readFile: mockReadFile,
      },
    });

    await expect(manager.getCommandTemplate("test")).rejects.toThrow(
      "Command template 'test' must be defined strictly as an array of strings to prevent shell-injection vulnerabilities.",
    );
  });

  it("should throw an error if the requested template key is missing from the configuration file", async () => {
    const mockReadFile = vi.fn().mockResolvedValue(
      JSON.stringify({
        otherKey: ["npm", "run", "build"],
      }),
    );

    const manager = new ConfigManager({
      homeDir: "/home/user",
      workspaceDir: "/workspace",
      fsPromises: {
        access: vi.fn(),
        mkdir: vi.fn(),
        writeFile: vi.fn(),
        chmod: vi.fn(),
        readFile: mockReadFile,
      },
    });

    await expect(manager.getCommandTemplate("test")).rejects.toThrow(
      "Command template 'test' was not found in agent.config.json.",
    );
  });

  it("should throw an error if the agent.config.json is invalid JSON", async () => {
    const mockReadFile = vi.fn().mockResolvedValue("invalid json payload");

    const manager = new ConfigManager({
      homeDir: "/home/user",
      workspaceDir: "/workspace",
      fsPromises: {
        access: vi.fn(),
        mkdir: vi.fn(),
        writeFile: vi.fn(),
        chmod: vi.fn(),
        readFile: mockReadFile,
      },
    });

    await expect(manager.getCommandTemplate("test")).rejects.toThrow();
  });
});
