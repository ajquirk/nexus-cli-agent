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
    /**
     * Optional read file injector to support isolated workspace reading
     */
    readFile?(
      path: string,
      options?: { encoding?: BufferEncoding; flag?: string } | null,
    ): Promise<string | Buffer>;
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
  private fsPromises: Required<NonNullable<ConfigManagerOptions["fsPromises"]>>;

  constructor(options?: ConfigManagerOptions) {
    this.homeDir =
      options?.homeDir || process.env.HOME || process.env.USERPROFILE || "";
    this.workspaceDir = options?.workspaceDir || process.cwd();

    // Construct the fsPromises mapping to ensure backwards compatibility with partial injections
    const injectedFs = options?.fsPromises;
    this.fsPromises = {
      access: injectedFs?.access || realFsPromises.access,
      mkdir: injectedFs?.mkdir || realFsPromises.mkdir,
      writeFile: injectedFs?.writeFile || realFsPromises.writeFile,
      chmod: injectedFs?.chmod || realFsPromises.chmod,
      readFile: injectedFs?.readFile || realFsPromises.readFile,
    } as Required<NonNullable<ConfigManagerOptions["fsPromises"]>>;
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
   * Retrieve parameterized command templates from the local agent.config.json configuration.
   * Ensures that command templates are strictly structured as arrays of strings.
   */
  async getCommandTemplate(key: string): Promise<string[]> {
    const configPath = this.getWorkspaceConfigPath();
    const content = await this.fsPromises.readFile(configPath, {
      encoding: "utf-8",
    });
    const parsed = JSON.parse(content as string);

    if (!parsed || typeof parsed !== "object") {
      throw new Error(`Invalid configuration format in ${configPath}`);
    }

    let template: unknown;
    let found = false;

    if (key in parsed) {
      template = (parsed as Record<string, unknown>)[key];
      found = true;
    } else if (
      "commands" in parsed &&
      parsed.commands &&
      typeof parsed.commands === "object" &&
      key in parsed.commands
    ) {
      template = (parsed.commands as Record<string, unknown>)[key];
      found = true;
    }

    if (!found) {
      throw new Error(
        `Command template '${key}' was not found in agent.config.json.`,
      );
    }

    if (
      !Array.isArray(template) ||
      !template.every((item) => typeof item === "string")
    ) {
      throw new Error(
        `Command template '${key}' must be defined strictly as an array of strings to prevent shell-injection vulnerabilities.`,
      );
    }

    return template as string[];
  }
}
