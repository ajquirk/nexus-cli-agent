/**
 * Utility class to validate command arguments and paths to protect against
 * command chain injection and directory traversal attacks [REQ-04].
 */
export class SafeCommandValidator {
  // Regex identifying dangerous shell metacharacters:
  // - \0 (null byte)
  // - ; (semicolon)
  // - \n, \r (newlines)
  // - & (ampersand, backgrounding / logical AND)
  // - | (pipe, logical OR)
  // - >, < (redirection)
  // - ` (backticks)
  // - $ (variable prefix / command substitution)
  // - (, ) (command sub/nested shells)
  private static readonly METACHRACTERS_REGEX = /[\0;\n\r&|><\`$()]/;

  /**
   * Validates a target path argument for safe execution.
   *
   * @param targetPath - The incoming target file path or argument.
   * @throws Error with a descriptive message if the path is invalid or dangerous.
   */
  public static validateTargetPath(targetPath: string): void {
    // 1. Check for empty, undefined, or whitespace-only inputs
    if (!targetPath || targetPath.trim() === "") {
      throw new Error("Invalid parameter path: cannot be empty");
    }

    // 2. Scan for shell metacharacters to prevent execution chain injection
    if (this.METACHRACTERS_REGEX.test(targetPath)) {
      throw new Error(
        "Invalid parameter path: shell metacharacter injection detected",
      );
    }

    // 3. Detect directory traversal attempts by parsing path segments
    // Splitting by both forward and backward slashes for OS portability
    const segments = targetPath.split(/[/\\]/);
    if (segments.includes("..")) {
      throw new Error(
        "Invalid parameter path: directory traversal attempt detected",
      );
    }
  }
}
