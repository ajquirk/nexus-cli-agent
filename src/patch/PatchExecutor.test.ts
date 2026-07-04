import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PatchExecutor,
  FileSystemInterface,
  SearchReplaceBlock,
} from "./PatchExecutor.js";

describe("PatchExecutor", () => {
  let mockFs: FileSystemInterface;
  let executor: PatchExecutor;
  let fileStore: Record<string, string>;

  beforeEach(() => {
    // Clear and initialize an in-memory virtual filesystem for isolation
    fileStore = {};
    mockFs = {
      readFile: vi
        .fn()
        .mockImplementation(async (path: string, encoding: string) => {
          if (!(path in fileStore)) {
            throw new Error(
              `ENOENT: no such file or directory, open '${path}'`,
            );
          }
          return fileStore[path];
        }),
      writeFile: vi
        .fn()
        .mockImplementation(
          async (path: string, content: string, encoding: string) => {
            fileStore[path] = content;
          },
        ),
    };

    executor = new PatchExecutor({ fs: mockFs });
  });

  describe("applyPatch - Successful Modifications", () => {
    it("should successfully patch a single line match", async () => {
      const filePath = "src/index.ts";
      fileStore[filePath] = "const x = 5;\nconst y = 10;\nconst z = 15;";

      const block: SearchReplaceBlock = {
        filePath,
        find: "const y = 10;",
        replace: "const y = 20;",
      };

      await executor.applyPatch(block);

      expect(fileStore[filePath]).toBe(
        "const x = 5;\nconst y = 20;\nconst z = 15;",
      );
      expect(mockFs.readFile).toHaveBeenCalledWith(filePath, "utf8");
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        filePath,
        "const x = 5;\nconst y = 20;\nconst z = 15;",
        "utf8",
      );
    });

    it("should successfully patch a multi-line contextual block", async () => {
      const filePath = "src/utils.ts";
      fileStore[filePath] = [
        "function add(a, b) {",
        "  return a + b;",
        "}",
        "",
        "function subtract(a, b) {",
        "  return a - b;",
        "}",
      ].join("\n");

      const block: SearchReplaceBlock = {
        filePath,
        find: ["function add(a, b) {", "  return a + b;", "}"].join("\n"),
        replace: [
          "function add(a: number, b: number): number {",
          "  return a + b;",
          "}",
        ].join("\n"),
      };

      await executor.applyPatch(block);

      const expectedContent = [
        "function add(a: number, b: number): number {",
        "  return a + b;",
        "}",
        "",
        "function subtract(a, b) {",
        "  return a - b;",
        "}",
      ].join("\n");

      expect(fileStore[filePath]).toBe(expectedContent);
    });

    it("should handle files with mismatched CRLF and LF newlines gracefully by normalising matches", async () => {
      const filePath = "src/windows.ts";
      // File has Windows CRLF line endings
      fileStore[filePath] = "const a = 1;\r\nconst b = 2;\r\nconst c = 3;";

      // Patch contains standard LF line endings
      const block: SearchReplaceBlock = {
        filePath,
        find: "const a = 1;\nconst b = 2;",
        replace: "const a = 10;\nconst b = 20;",
      };

      await executor.applyPatch(block);

      // We expect the file content to be updated. It can preserve or uniform the newlines.
      // Let's check that the target substring got replaced.
      const updated = fileStore[filePath].replace(/\r\n/g, "\n");
      expect(updated).toBe("const a = 10;\nconst b = 20;\nconst c = 3;");
    });
  });

  describe("applyPatch - Error Cases & Failure Modes", () => {
    it("should throw standard exact error message when find block is not resolved in target file", async () => {
      const filePath = "src/index.ts";
      fileStore[filePath] = "const x = 5;\nconst y = 10;\nconst z = 15;";

      const block: SearchReplaceBlock = {
        filePath,
        find: "const y = 999;", // Pattern not present
        replace: "const y = 20;",
      };

      await expect(executor.applyPatch(block)).rejects.toThrow(
        "Patch failed: Target match pattern not resolved in file",
      );

      // Verify the file was not modified
      expect(fileStore[filePath]).toBe(
        "const x = 5;\nconst y = 10;\nconst z = 15;",
      );
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it("should throw standard exact error when find block is present but does not match exactly", async () => {
      const filePath = "src/index.ts";
      fileStore[filePath] = "const x = 5;\nconst y = 10;\nconst z = 15;";

      const block: SearchReplaceBlock = {
        filePath,
        // Close, but missing semicolon to prevent imprecise partial matching
        find: "const y = 10",
        replace: "const y = 20;",
      };

      await expect(executor.applyPatch(block)).rejects.toThrow(
        "Patch failed: Target match pattern not resolved in file",
      );
    });

    it("should bubble up read errors if the target file does not exist", async () => {
      const block: SearchReplaceBlock = {
        filePath: "non-existent.ts",
        find: "something",
        replace: "else",
      };

      await expect(executor.applyPatch(block)).rejects.toThrow(
        /ENOENT: no such file or directory/,
      );
    });
  });
});
