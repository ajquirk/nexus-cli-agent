// src/storage/SQLiteStorageManager.ts
import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { ConfigManager } from "../config/ConfigManager.js";

export interface StepRecord {
  timestamp: string;
  toolName: string;
  args: Record<string, any>;
  stdoutSummary?: string;
  tokenCountEstimate: number;
}

export interface SQLiteStorageManager {
  initializeDatabase(): Promise<void>;
  saveStep(
    sessionId: string,
    stepIndex: number,
    payload: StepRecord,
  ): Promise<void>;
  getSessionHistory(sessionId: string): Promise<StepRecord[]>;
  logRateLimitCooldown(provider: string, resetEpochMs: number): Promise<void>;
  getRateLimitCooldown(provider: string): Promise<number | null>;
}

export interface SQLiteStorageManagerOptions {
  /**
   * Overrides the SQLite database file path.
   * If not specified, defaults to resolving ~/.config/nexus/history.db
   */
  databasePath?: string;
}

const SCHEMA_EXECUTION_SESSIONS = `
  CREATE TABLE IF NOT EXISTS execution_sessions (
    session_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
`;

const SCHEMA_STEP_LOGS = `
  CREATE TABLE IF NOT EXISTS step_logs (
    session_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    args TEXT NOT NULL,
    stdout_summary TEXT,
    token_count_estimate INTEGER NOT NULL,
    PRIMARY KEY (session_id, step_index),
    FOREIGN KEY (session_id) REFERENCES execution_sessions(session_id) ON DELETE CASCADE
  );
`;

const SCHEMA_PROVIDER_COOLDOWNS = `
  CREATE TABLE IF NOT EXISTS provider_cooldowns (
    provider TEXT PRIMARY KEY,
    reset_epoch_ms INTEGER NOT NULL
  );
`;

export class SQLiteStorageManagerImpl implements SQLiteStorageManager {
  private dbPath: string;
  private db: Database.Database | null = null;

  constructor(options?: SQLiteStorageManagerOptions) {
    if (options?.databasePath) {
      this.dbPath = options.databasePath;
    } else {
      const config = new ConfigManager();
      this.dbPath = path.join(config.getNexusConfigDir(), "history.db");
    }
  }

  /**
   * Getter to expose the resolved path for testing configuration.
   */
  getDatabasePath(): string {
    return this.dbPath;
  }

  /**
   * Closes the active database connection and frees system file handles.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async initializeDatabase(): Promise<void> {
    const parentDir = path.dirname(this.dbPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    if (!this.db) {
      this.db = new Database(this.dbPath);
    }

    // Configure write-ahead logging (WAL) mode
    this.db.pragma("journal_mode = WAL");

    // Create required tables
    this.db.exec(SCHEMA_EXECUTION_SESSIONS);
    this.db.exec(SCHEMA_STEP_LOGS);
    this.db.exec(SCHEMA_PROVIDER_COOLDOWNS);
  }

  async saveStep(
    _sessionId: string,
    _stepIndex: number,
    _payload: StepRecord,
  ): Promise<void> {
    // Defined as stub for future TASK implementation
    return Promise.resolve();
  }

  async getSessionHistory(_sessionId: string): Promise<StepRecord[]> {
    // Defined as stub for future TASK implementation
    return Promise.resolve([]);
  }

  async logRateLimitCooldown(
    _provider: string,
    _resetEpochMs: number,
  ): Promise<void> {
    // Defined as stub for future TASK implementation
    return Promise.resolve();
  }

  async getRateLimitCooldown(_provider: string): Promise<number | null> {
    // Defined as stub for future TASK implementation
    return Promise.resolve(null);
  }
}
