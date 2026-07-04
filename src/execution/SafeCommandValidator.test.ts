import { describe, it, expect } from "vitest";
import { SafeCommandValidator } from "./SafeCommandValidator.js";

describe("SafeCommandValidator", () => {
  describe("validateTargetPath - Valid Configurations", () => {
    it("should allow standard valid relative file paths", () => {
      expect(() => {
        SafeCommandValidator.validateTargetPath("src/auth.test.ts");
      }).not.toThrow();

      expect(() => {
        SafeCommandValidator.validateTargetPath("package.json");
      }).not.toThrow();

      expect(() => {
        SafeCommandValidator.validateTargetPath("src/config/ConfigManager.ts");
      }).not.toThrow();

      expect(() => {
        SafeCommandValidator.validateTargetPath("./index.js");
      }).not.toThrow();
    });

    it("should allow safe characters like underscores, hyphens, and dots within names", () => {
      expect(() => {
        SafeCommandValidator.validateTargetPath("src/my-helper_file.v1.ts");
      }).not.toThrow();
    });
  });

  describe("validateTargetPath - Shell Injection Protection", () => {
    const injectionCases = [
      {
        path: "src/auth.test.ts; rm -rf /",
        desc: "semicolon chained commands",
      },
      {
        path: "src/auth.test.ts && cat /etc/passwd",
        desc: "logical AND execution",
      },
      { path: "src/auth.test.ts || echo 'fail'", desc: "logical OR execution" },
      { path: "src/auth.test.ts | grep 'pattern'", desc: "pipe redirection" },
      { path: "src/auth.test.ts > output.log", desc: "output redirection" },
      { path: "src/auth.test.ts < input.txt", desc: "input redirection" },
      { path: "src/auth.test.ts`id`", desc: "backtick execution" },
      {
        path: "src/auth.test.ts$(whoami)",
        desc: "dollar-parenthesis execution",
      },
      {
        path: "src/auth.test.ts\nrm -rf /",
        desc: "newline separator execution",
      },
      { path: "src/auth.test.ts\rreboot", desc: "carriage return separator" },
      { path: "src/auth.test.ts&fg", desc: "background execution operator" },
      { path: "$ENV_VAR", desc: "shell variable prefix" },
    ];

    injectionCases.forEach(({ path, desc }) => {
      it(`should block ${desc}`, () => {
        expect(() => {
          SafeCommandValidator.validateTargetPath(path);
        }).toThrow(
          /Invalid parameter path: shell metacharacter injection detected/,
        );
      });
    });
  });

  describe("validateTargetPath - Directory Traversal Protection", () => {
    const traversalCases = [
      { path: "../etc/passwd", desc: "leading double dots" },
      { path: "src/../../etc/passwd", desc: "embedded double dots" },
      { path: "..", desc: "isolated double dots" },
      { path: "src/..", desc: "trailing double dots" },
      { path: "src/auth.test.ts/..", desc: "slash double dots" },
    ];

    traversalCases.forEach(({ path, desc }) => {
      it(`should block directory traversal using ${desc}`, () => {
        expect(() => {
          SafeCommandValidator.validateTargetPath(path);
        }).toThrow(
          /Invalid parameter path: directory traversal attempt detected/,
        );
      });
    });
  });

  describe("validateTargetPath - Edge Cases & Empty Values", () => {
    it("should reject empty, undefined, or white-space-only target paths", () => {
      expect(() => {
        SafeCommandValidator.validateTargetPath("");
      }).toThrow(/Invalid parameter path: cannot be empty/);

      expect(() => {
        SafeCommandValidator.validateTargetPath("   ");
      }).toThrow(/Invalid parameter path: cannot be empty/);
    });

    it("should block null-byte characters", () => {
      expect(() => {
        SafeCommandValidator.validateTargetPath("src/auth.ts\0.js");
      }).toThrow(
        /Invalid parameter path: shell metacharacter injection detected/,
      );
    });
  });
});
