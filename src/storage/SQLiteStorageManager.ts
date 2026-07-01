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
    sessionId: string,
    stepIndex: number,
    payload: StepRecord,
  ): Promise<void> {
    if (!this.db) {
      throw new Error(
        "Database not initialized. Call initializeDatabase() first.",
      );
    }

    const insertSession = this.db.prepare(`
      INSERT OR IGNORE INTO execution_sessions (session_id)
      VALUES (?)
    `);

    const insertStep = this.db.prepare(`
      INSERT OR REPLACE INTO step_logs (
        session_id,
        step_index,
        timestamp,
        tool_name,
        args,
        stdout_summary,
        token_count_estimate
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // Wrap in an ACID-compliant transaction to assert execution safety
    const transaction = this.db.transaction(() => {
      insertSession.run(sessionId);
      insertStep.run(
        sessionId,
        stepIndex,
        payload.timestamp,
        payload.toolName,
        JSON.stringify(payload.args),
        payload.stdoutSummary ?? null,
        payload.tokenCountEstimate,
      );
    });

    transaction();
  }

  async getSessionHistory(sessionId: string): Promise<StepRecord[]> {
    if (!this.db) {
      throw new Error(
        "Database not initialized. Call initializeDatabase() first.",
      );
    }

    const stmt = this.db.prepare(`
      SELECT timestamp, tool_name, args, stdout_summary, token_count_estimate
      FROM step_logs
      WHERE session_id = ?
      ORDER BY step_index ASC
    `);

    const rows = stmt.all(sessionId) as {
      timestamp: string;
      tool_name: string;
      args: string;
      stdout_summary: string | null;
      token_count_estimate: number;
    }[];

    return rows.map((row) => {
      const record: StepRecord = {
        timestamp: row.timestamp,
        toolName: row.tool_name,
        args: JSON.parse(row.args),
        tokenCountEstimate: row.token_count_estimate,
      };

      if (row.stdout_summary !== null) {
        record.stdoutSummary = row.stdout_summary;
      }

      return record;
    });
  }

  async logRateLimitCooldown(
    provider: string,
    resetEpochMs: number,
  ): Promise<void> {
    if (!this.db) {
      throw new Error(
        "Database not initialized. Call initializeDatabase() first.",
      );
    }

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO provider_cooldowns (provider, reset_epoch_ms)
      VALUES (?, ?)
    `);

    stmt.run(provider, resetEpochMs);
  }

  async getRateLimitCooldown(provider: string): Promise<number | null> {
    if (!this.db) {
      throw new Error(
        "Database not initialized. Call initializeDatabase() first.",
      );
    }

    const stmt = this.db.prepare(`
      SELECT reset_epoch_ms FROM provider_cooldowns WHERE provider = ?
    `);

    const row = stmt.get(provider) as { reset_epoch_ms: number } | undefined;
    if (!row) {
      return null;
    }

    return row.reset_epoch_ms;
  }
}
