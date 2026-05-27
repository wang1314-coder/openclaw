import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type TempDirCollection = string[] | Set<string>;

export interface TestTempDirTracker {
  readonly dirs: ReadonlySet<string>;
  make(prefix: string): string;
  cleanup(): void;
}

export function makeTempDir(tempDirs: string[] | Set<string>, prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  if (Array.isArray(tempDirs)) {
    tempDirs.push(dir);
  } else {
    tempDirs.add(dir);
  }
  return dir;
}

export function cleanupTempDirs(tempDirs: TempDirCollection): void {
  const dirs = Array.isArray(tempDirs) ? tempDirs.splice(0) : [...tempDirs];
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
  if (!Array.isArray(tempDirs)) {
    tempDirs.clear();
  }
}

export function createTempDirTracker(): TestTempDirTracker {
  const dirs = new Set<string>();
  return {
    dirs,
    make(prefix: string): string {
      return makeTempDir(dirs, prefix);
    },
    cleanup(): void {
      cleanupTempDirs(dirs);
    },
  };
}
