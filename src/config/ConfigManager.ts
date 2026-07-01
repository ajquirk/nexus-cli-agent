import * as fs from "node:fs";
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

export class ConfigManager {
  private homeDir: string;
  private workspaceDir: string;

  constructor(options?: ConfigManagerOptions) {
    this.homeDir =
      options?.homeDir || process.env.HOME || process.env.USERPROFILE || "";
    this.workspaceDir = options?.workspaceDir || process.cwd();
  }

  /**
   * Resolves the target directory path for user-level configurations (~/.config/nexus/)
   */
  getNexusConfigDir(): string {
    return path.join(this.homeDir, ".config", "nexus");
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
   * Initializes local user-level configuration path resolution, generates default templates,
   * and secures the directories and files with correct permission modes.
   */
  async initializeConfig(): Promise<void> {
    const configDir = this.getNexusConfigDir();
    const envFile = this.getEnvFilePath();
    const workspaceConfigFile = this.getWorkspaceConfigPath();

    // 1. Create target user-level configuration directory if it does not exist
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // 2. Create the credentials file inside the directory if it does not exist
    if (!fs.existsSync(envFile)) {
      fs.writeFileSync(envFile, "", { encoding: "utf-8", mode: 0o600 });
    }

    // 3. Restrict directory permissions to user-read-and-write-only (0600)
    if (process.platform !== "win32") {
      fs.chmodSync(configDir, 0o600);
    }

    // 4. Create the workspace configuration template in the project root if it does not exist
    if (!fs.existsSync(workspaceConfigFile)) {
      fs.writeFileSync(
        workspaceConfigFile,
        JSON.stringify(DEFAULT_WORKSPACE_CONFIG, null, 2),
        "utf-8",
      );
    }
  }
}
