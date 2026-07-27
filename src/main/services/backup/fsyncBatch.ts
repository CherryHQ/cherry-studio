import { open } from 'node:fs/promises'
import path from 'node:path'

/**
 * Durability fsync helpers for the export producer (Phase 1b-i).
 *
 * `fsyncParentDirsBatched` flushes the DISTINCT parent directories of a set of
 * files, doing exactly one `fsync` per distinct parent — so the fsync count
 * scales with affected directories, not entry count. This is the bound the
 * preboot install path (Phase 2/3) reuses so a large resource set cannot turn
 * durability into an unbounded per-entry `fsync` storm.
 *
 * The `fsyncFile` / `fsyncDir` object form is a test seam (spy the fsync count
 * without mocking `node:fs` bindings). Windows cannot fsync a directory handle,
 * so directory fsync is a documented no-op there (same trade-off as
 * `writeRestoreJournal`).
 *
 * BENCHMARK NOTE (no wall-clock assertion): the guarantee this helper provides is
 * a COUNT bound — `O(distinct parent directories)`, independent of file count —
 * proven by the gating `fsyncBatch.test.ts` fixture (100 files in one dir → 1
 * fsync). A non-gating wall-clock benchmark (`__tests__/fsyncBatch.bench.ts`,
 * bounded to 100 files) is recorded with its exact command, environment, and one
 * measured run in `__tests__/fsyncBatch.bench.md`; no timing is asserted in CI.
 */
export const durability = {
  async fsyncFile(target: string): Promise<void> {
    const handle = await open(target, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  },

  async fsyncDir(dir: string): Promise<void> {
    if (process.platform === 'win32') return
    const handle = await open(dir, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
}

export interface BatchedFsyncResult {
  /** The distinct parent directories that were fsynced (sorted, deduplicated). */
  readonly fsyncedDirs: readonly string[]
}

/**
 * Fsync each distinct parent directory of `filePaths` exactly once. Returns the
 * deduplicated directory list so a fixture can assert the fsync count equals the
 * number of distinct parents (not the number of files).
 */
export async function fsyncParentDirsBatched(filePaths: readonly string[]): Promise<BatchedFsyncResult> {
  const dirs = [...new Set(filePaths.map((p) => path.dirname(p)))].sort()
  for (const dir of dirs) {
    await durability.fsyncDir(dir)
  }
  return { fsyncedDirs: dirs }
}
