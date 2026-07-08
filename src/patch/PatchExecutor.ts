import * as fsPromises from "node:fs/promises";

export interface SearchReplaceBlock {
  filePath: string;
  find: string;
  replace: string;
}

export interface FileSystemInterface {
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, content: string, encoding: "utf8"): Promise<void>;
}

export interface PatchExecutorOptions {
  fs?: FileSystemInterface;
}

export class AmbiguousPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousPatchError";
  }
}

const defaultFs: FileSystemInterface = {
  async readFile(path: string, encoding: "utf8"): Promise<string> {
    return fsPromises.readFile(path, { encoding });
  },
  async writeFile(
    path: string,
    content: string,
    encoding: "utf8",
  ): Promise<void> {
    await fsPromises.writeFile(path, content, { encoding });
  },
};

export class PatchExecutor {
  private fs: FileSystemInterface;

  constructor(options: PatchExecutorOptions = {}) {
    this.fs = options.fs || defaultFs;
  }

  /**
   * Applies a contextual search-and-replace block directly to the target file.
   * Throws if the exact find pattern is not resolved or is not line-boundary aligned.
   * Throws an AmbiguousPatchError if multiple line-aligned matches are found.
   */
  async applyPatch(block: SearchReplaceBlock): Promise<void> {
    const originalContent = await this.fs.readFile(block.filePath, "utf8");

    // Detect if the original file utilizes CRLF line endings
    const usesCRLF = originalContent.includes("\r\n");

    // Normalize all line endings to LF (\n) to perform robust matches
    const normalizedContent = originalContent.replace(/\r\n/g, "\n");
    const normalizedFind = block.find.replace(/\r\n/g, "\n");
    const normalizedReplace = block.replace.replace(/\r\n/g, "\n");

    const matchedIndices: number[] = [];
    let searchStartIndex = 0;

    // Scan for all line-aligned occurrences
    while (true) {
      const currentIndex = normalizedContent.indexOf(
        normalizedFind,
        searchStartIndex,
      );
      if (currentIndex === -1) {
        break;
      }

      // Check alignment at the start of the match
      const isBeforeAligned =
        normalizedFind.startsWith("\n") ||
        currentIndex === 0 ||
        normalizedContent[currentIndex - 1] === "\n";

      // Check alignment at the end of the match
      const isAfterAligned =
        normalizedFind.endsWith("\n") ||
        currentIndex + normalizedFind.length === normalizedContent.length ||
        normalizedContent[currentIndex + normalizedFind.length] === "\n";

      if (isBeforeAligned && isAfterAligned) {
        matchedIndices.push(currentIndex);
      }

      // Increment search cursor to check other potential matches
      searchStartIndex = currentIndex + 1;
    }

    if (matchedIndices.length === 0) {
      throw new Error(
        "Patch failed: Target match pattern not resolved in file",
      );
    }

    if (matchedIndices.length > 1) {
      throw new AmbiguousPatchError(
        `Patch failed: Multiple matches were identified in file. Found ${matchedIndices.length} occurrences of target match pattern.`,
      );
    }

    const foundMatchIndex = matchedIndices[0];

    // Splice in the replacement
    const patchedNormalized =
      normalizedContent.slice(0, foundMatchIndex) +
      normalizedReplace +
      normalizedContent.slice(foundMatchIndex + normalizedFind.length);

    // Re-apply original line-ending format if CRLF was detected
    const finalContent = usesCRLF
      ? patchedNormalized.replace(/\n/g, "\r\n")
      : patchedNormalized;

    await this.fs.writeFile(block.filePath, finalContent, "utf8");
  }
}
