// src/storage/SQLiteStorageManager.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import Database from "better-sqlite3";
import { SQLiteStorageManagerImpl } from "./SQLiteStorageManager.js";

describe("SQLiteStorageManager Database Initialization", () => {
  let tempDir: string;
  let tempDbPath: string;
  let manager: SQLiteStorageManagerImpl | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-db-test-"));
    tempDbPath = path.join(tempDir, "history.db");
    manager = null;
  });

  afterEach(() => {
    try {
      // Close the manager connection first to release file locks
      if (manager) {
        manager.close();
      }

      if (fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
      }

      const walFile = `${tempDbPath}-wal`;
      const shmFile = `${tempDbPath}-shm`;
      if (fs.existsSync(walFile)) fs.unlinkSync(walFile);
      if (fs.existsSync(shmFile)) fs.unlinkSync(shmFile);

      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir);
      }
    } catch (err) {
      // Ignore cleanup errors during test runs
    }
  });

  it("should initialize with a custom database path injected", () => {
    manager = new SQLiteStorageManagerImpl({ databasePath: tempDbPath });
    expect(manager.getDatabasePath()).toBe(tempDbPath);
  });

  it("should create the database file and containing directory if it does not exist", async () => {
    const nestedDbPath = path.join(tempDir, "nested-subdir", "history.db");
    manager = new SQLiteStorageManagerImpl({ databasePath: nestedDbPath });

    expect(fs.existsSync(nestedDbPath)).toBe(false);

    await manager.initializeDatabase();

    expect(fs.existsSync(nestedDbPath)).toBe(true);
  });

  it("should operate in WAL journal mode", async () => {
    manager = new SQLiteStorageManagerImpl({ databasePath: tempDbPath });
    await manager.initializeDatabase();

    const db = new Database(tempDbPath);
    try {
      const journalMode = db.pragma("journal_mode", { simple: true }) as string;
      expect(journalMode?.toLowerCase()).toBe("wal");
    } finally {
      db.close();
    }
  });

  it("should define execution_sessions table with the correct schema", async () => {
    manager = new SQLiteStorageManagerImpl({ databasePath: tempDbPath });
    await manager.initializeDatabase();

    const db = new Database(tempDbPath);
    try {
      const columns = db.pragma("table_info(execution_sessions)") as any[];
      expect(columns).toBeDefined();
      expect(columns.length).toBeGreaterThan(0);

      const sessionIdCol = columns.find((c) => c.name === "session_id");
      const createdAtCol = columns.find((c) => c.name === "created_at");

      expect(sessionIdCol).toBeDefined();
      expect(sessionIdCol.type.toUpperCase()).toBe("TEXT");
      expect(sessionIdCol.pk).toBe(1);

      expect(createdAtCol).toBeDefined();
      expect(createdAtCol.type.toUpperCase()).toBe("TEXT");
    } finally {
      db.close();
    }
  });

  it("should define step_logs table with correct schemas and primary keys", async () => {
    manager = new SQLiteStorageManagerImpl({ databasePath: tempDbPath });
    await manager.initializeDatabase();

    const db = new Database(tempDbPath);
    try {
      const columns = db.pragma("table_info(step_logs)") as any[];
      expect(columns).toBeDefined();

      const expectedCols = [
        { name: "session_id", type: "TEXT" },
        { name: "step_index", type: "INTEGER" },
        { name: "timestamp", type: "TEXT" },
        { name: "tool_name", type: "TEXT" },
        { name: "args", type: "TEXT" },
        { name: "stdout_summary", type: "TEXT" },
        { name: "token_count_estimate", type: "INTEGER" },
      ];

      for (const expected of expectedCols) {
        const col = columns.find((c) => c.name === expected.name);
        expect(col, `Column ${expected.name} should exist`).toBeDefined();
        expect(col.type.toUpperCase()).toBe(expected.type);
      }

      const sessionIdCol = columns.find((c) => c.name === "session_id");
      const stepIndexCol = columns.find((c) => c.name === "step_index");
      expect(sessionIdCol.pk).toBeGreaterThan(0);
      expect(stepIndexCol.pk).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("should define provider_cooldowns table with correct schema", async () => {
    manager = new SQLiteStorageManagerImpl({ databasePath: tempDbPath });
    await manager.initializeDatabase();

    const db = new Database(tempDbPath);
    try {
      const columns = db.pragma("table_info(provider_cooldowns)") as any[];
      expect(columns).toBeDefined();

      const providerCol = columns.find((c) => c.name === "provider");
      const resetCol = columns.find((c) => c.name === "reset_epoch_ms");

      expect(providerCol).toBeDefined();
      expect(providerCol.type.toUpperCase()).toBe("TEXT");
      expect(providerCol.pk).toBe(1);

      expect(resetCol).toBeDefined();
      expect(resetCol.type.toUpperCase()).toBe("INTEGER");
    } finally {
      db.close();
    }
  });

  it("should support multiple redundant initializations without throwing (idempotency)", async () => {
    manager = new SQLiteStorageManagerImpl({ databasePath: tempDbPath });

    await expect(manager.initializeDatabase()).resolves.not.toThrow();
    await expect(manager.initializeDatabase()).resolves.not.toThrow();
  });
});
