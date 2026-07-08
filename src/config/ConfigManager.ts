import * as fs from "node:fs";
import * as realFsPromises from "node:fs/promises";
import * as path from "node:path";

export interface ConfigManagerOptions {
  /**
   * Overrides the resolved home directory path (normally process.env.HOME)
   */
  homeDir?: string;
  /**
   * Overrides the resolved workspace root directory path (normally process.cwd())
   */
  workspaceDir?: string;
  /**
   * Allows injecting a custom fs/promises implementation to isolate filesystem side-effects [2]
   */
  fsPromises?: {
    access(path: string): Promise<void>;
    mkdir(
      path: string,
      options?: { recursive?: boolean },
    ): Promise<string | undefined>;
    writeFile(
      path: string,
      data: string | Uint8Array,
      options?: any,
    ): Promise<void>;
    chmod(path: string, mode: number | string): Promise<void>;
  };
}

export interface WorkspaceConfig {
  limits: {
    stepLimit: number;
  };
}

const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  limits: {
    stepLimit: 30, // Defined standard boundary
  },
};

export interface IConfigManager {
  initializeConfig(): Promise<void>;
  getCommandTemplate(key: string): Promise<string[]>;
  getConfigDirectoryPath(): string;
}

export class ConfigManager implements IConfigManager {
  private homeDir: string;
  private workspaceDir: string;
  private fsPromises: Required<ConfigManagerOptions>["fsPromises"];

  constructor(options?: ConfigManagerOptions) {
    this.homeDir =
      options?.homeDir || process.env.HOME || process.env.USERPROFILE || "";
    this.workspaceDir = options?.workspaceDir || process.cwd();
    // Default to the native fs/promises module if none is injected [2]
    this.fsPromises = (options?.fsPromises ||
      realFsPromises) as Required<ConfigManagerOptions>["fsPromises"];
  }

  /**
   * Resolves the target directory path for user-level configurations (~/.config/nexus/)
   */
  getNexusConfigDir(): string {
    return path.join(this.homeDir, ".config", "nexus");
  }

  /**
   * Returns the exact same user-level configuration directory path, fulfilling the PRD contract.
   */
  getConfigDirectoryPath(): string {
    return this.getNexusConfigDir();
  }

  /**
   * Resolves the target path for the credentials file (~/.config/nexus/.env)
   */
  getEnvFilePath(): string {
    return path.join(this.getNexusConfigDir(), ".env");
  }

  /**
   * Resolves the target path for the workspace config (agent.config.json)
   */
  getWorkspaceConfigPath(): string {
    return path.join(this.workspaceDir, "agent.config.json");
  }

  /**
   * Initializes local user-level configuration path resolution asynchronously,
   * creates default templates, and secures the directories with restricted permission modes.
   */
  async initializeConfig(): Promise<void> {
    const configDir = this.getNexusConfigDir();
    const envFile = this.getEnvFilePath();
    const workspaceConfigFile = this.getWorkspaceConfigPath();

    // 1. Create target user-level configuration directory if it does not exist
    try {
      await this.fsPromises.access(configDir);
    } catch {
      await this.fsPromises.mkdir(configDir, { recursive: true });
    }

    // 2. Create the credentials file inside the directory if it does not exist (enforces 0o600 for the file)
    try {
      await this.fsPromises.access(envFile);
    } catch {
      await this.fsPromises.writeFile(envFile, "", {
        encoding: "utf-8",
        mode: 0o600,
      });
    }

    // 3. Restrict directory permissions to user-read-write-execute (0o700) on POSIX platforms [2]
    if (process.platform !== "win32") {
      await this.fsPromises.chmod(configDir, 0o700);
    }

    // 4. Create the workspace configuration template in the project root if it does not exist
    try {
      await this.fsPromises.access(workspaceConfigFile);
    } catch {
      await this.fsPromises.writeFile(
        workspaceConfigFile,
        JSON.stringify(DEFAULT_WORKSPACE_CONFIG, null, 2),
        "utf-8",
      );
    }
  }

  /**
   * Retrieve parameterized command templates (stubbed for future JSON configuration parsing steps)
   */
  async getCommandTemplate(key: string): Promise<string[]> {
    return [];
  }
}
