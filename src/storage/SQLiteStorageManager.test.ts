// src/storage/SQLiteStorageManager.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import Database from "better-sqlite3";
import {
  SQLiteStorageManagerImpl,
  StepRecord,
} from "./SQLiteStorageManager.js";

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

describe("SQLiteStorageManager Step Logging Operations", () => {
  let tempDir: string;
  let tempDbPath: string;
  let manager: SQLiteStorageManagerImpl;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-step-test-"));
    tempDbPath = path.join(tempDir, "history.db");
    manager = new SQLiteStorageManagerImpl({ databasePath: tempDbPath });
    await manager.initializeDatabase();
  });

  afterEach(() => {
    try {
      manager.close();
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      const walFile = `${tempDbPath}-wal`;
      const shmFile = `${tempDbPath}-shm`;
      if (fs.existsSync(walFile)) fs.unlinkSync(walFile);
      if (fs.existsSync(shmFile)) fs.unlinkSync(shmFile);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should save and retrieve a single step record with identical values", async () => {
    const sessionId = "session-abc";
    const stepRecord: StepRecord = {
      timestamp: "2026-06-30T12:00:00Z",
      toolName: "read_file",
      args: { path: "src/auth.ts", flag: true },
      stdoutSummary: "Successfully read 120 lines",
      tokenCountEstimate: 150,
    };

    await manager.saveStep(sessionId, 0, stepRecord);
    const history = await manager.getSessionHistory(sessionId);

    expect(history).toHaveLength(1);
    expect(history[0]).toEqual(stepRecord);
  });

  it("should return an empty history list if the session has no logged steps", async () => {
    const history = await manager.getSessionHistory("non-existent-session");
    expect(history).toEqual([]);
  });

  it("should dynamically retrieve records in ascending order of step index", async () => {
    const sessionId = "session-ordered";
    const step0: StepRecord = {
      timestamp: "2026-06-30T12:00:00Z",
      toolName: "list_directory",
      args: { depth: 1 },
      tokenCountEstimate: 100,
    };
    const step1: StepRecord = {
      timestamp: "2026-06-30T12:01:00Z",
      toolName: "read_file",
      args: { path: "package.json" },
      tokenCountEstimate: 200,
    };
    const step2: StepRecord = {
      timestamp: "2026-06-30T12:02:00Z",
      toolName: "patch_file",
      args: { replacement: "test" },
      tokenCountEstimate: 300,
    };

    // Save in out-of-order sequence to ensure sorting relies on index rather than insert order
    await manager.saveStep(sessionId, 1, step1);
    await manager.saveStep(sessionId, 2, step2);
    await manager.saveStep(sessionId, 0, step0);

    const history = await manager.getSessionHistory(sessionId);

    expect(history).toHaveLength(3);
    expect(history[0]).toEqual(step0);
    expect(history[1]).toEqual(step1);
    expect(history[2]).toEqual(step2);
  });

  it("should handle optional undefined stdoutSummary field by omitting or reading it as undefined", async () => {
    const sessionId = "session-optional";
    const stepRecord: StepRecord = {
      timestamp: "2026-06-30T12:05:00Z",
      toolName: "no_output_tool",
      args: {},
      tokenCountEstimate: 50,
      // stdoutSummary is omitted
    };

    await manager.saveStep(sessionId, 0, stepRecord);
    const history = await manager.getSessionHistory(sessionId);

    expect(history).toHaveLength(1);
    expect(history[0].stdoutSummary).toBeUndefined();
    expect(history[0]).toEqual(stepRecord);
  });

  it("should round-trip deeply nested argument configurations safely", async () => {
    const sessionId = "session-nested-args";
    const stepRecord: StepRecord = {
      timestamp: "2026-06-30T12:10:00Z",
      toolName: "execute_complex_tool",
      args: {
        config: {
          debug: true,
          options: ["a", "b", { nestedFlag: false }],
        },
      },
      tokenCountEstimate: 500,
    };

    await manager.saveStep(sessionId, 0, stepRecord);
    const history = await manager.getSessionHistory(sessionId);

    expect(history).toHaveLength(1);
    expect(history[0].args.config.options[2].nestedFlag).toBe(false);
    expect(history[0]).toEqual(stepRecord);
  });
});

describe("SQLiteStorageManager Rate Limit Operations", () => {
  let tempDir: string;
  let tempDbPath: string;
  let manager: SQLiteStorageManagerImpl;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-rate-test-"));
    tempDbPath = path.join(tempDir, "history.db");
    manager = new SQLiteStorageManagerImpl({ databasePath: tempDbPath });
    await manager.initializeDatabase();
  });

  afterEach(() => {
    try {
      manager.close();
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      const walFile = `${tempDbPath}-wal`;
      const shmFile = `${tempDbPath}-shm`;
      if (fs.existsSync(walFile)) fs.unlinkSync(walFile);
      if (fs.existsSync(shmFile)) fs.unlinkSync(shmFile);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should return null when getting rate limit for an unrecorded provider", async () => {
    const cooldown = await manager.getRateLimitCooldown("unknown-provider");
    expect(cooldown).toBeNull();
  });

  it("should save and retrieve a rate limit cooldown timestamp", async () => {
    const provider = "openai";
    const resetEpoch = Date.now() + 60000;

    await manager.logRateLimitCooldown(provider, resetEpoch);
    const cooldown = await manager.getRateLimitCooldown(provider);

    expect(cooldown).toBe(resetEpoch);
  });

  it("should correctly upsert and overwrite preexisting rate limit cooldowns for the same provider", async () => {
    const provider = "anthropic";
    const initialReset = Date.now() + 10000;
    const secondaryReset = Date.now() + 30000;

    await manager.logRateLimitCooldown(provider, initialReset);
    await manager.logRateLimitCooldown(provider, secondaryReset);

    const cooldown = await manager.getRateLimitCooldown(provider);
    expect(cooldown).toBe(secondaryReset);
  });
});
