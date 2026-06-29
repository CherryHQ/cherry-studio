import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'

const logger = loggerService.withContext('AgentRoot')

/**
 * Identity files that live in an agent's root directory (read case-insensitively).
 * Distinct from the working directory (cwd): these define WHO the agent is, not
 * where it does its task work.
 */
export const IDENTITY_FILES = ['SOUL.md', 'USER.md', 'system.md'] as const

/** Subdirectory under the agent root holding durable memory (FACT.md, JOURNAL.jsonl). */
export const MEMORY_DIRNAME = 'memory'

/** Absolute path to a given agent's root directory under the roots base dir. */
export function agentRootPath(rootsBaseDir: string, agentId: string): string {
  return path.join(rootsBaseDir, agentId)
}

/** Ensure the agent root and its `memory/` subdirectory exist. Idempotent. */
export async function ensureAgentRoot(rootDir: string): Promise<void> {
  await mkdir(path.join(rootDir, MEMORY_DIRNAME), { recursive: true })
}

/**
 * Adopt an existing directory's identity + memory into an agent root.
 *
 * Copies the {@link IDENTITY_FILES} (case-insensitive) and the `memory/`
 * directory from `srcDir` into `rootDir`. Used by the v1 migrator to move a
 * legacy agent's soul/memory (written into its old working dir) into the new
 * stable per-agent root.
 *
 * Non-destructive: existing destination files are preserved (never overwritten).
 * Best-effort: a failure on a single artifact is logged and skipped, never
 * thrown — a partial copy must not abort the surrounding migration. Returns the
 * names of the artifacts that were copied.
 */
export async function importIdentityAndMemory(srcDir: string, rootDir: string): Promise<string[]> {
  const copied: string[] = []
  await ensureAgentRoot(rootDir)

  for (const name of IDENTITY_FILES) {
    try {
      const src = await resolveCaseInsensitive(srcDir, name)
      if (!src) continue
      // Skip if any case-variant already exists in the root — don't clobber.
      if (await resolveCaseInsensitive(rootDir, name)) continue
      await cp(src, path.join(rootDir, name))
      copied.push(name)
    } catch (error) {
      logger.warn(`Failed to import identity file ${name}`, { srcDir, rootDir, error })
    }
  }

  try {
    const srcMemory = await resolveCaseInsensitive(srcDir, MEMORY_DIRNAME)
    if (srcMemory) {
      // force:false + errorOnExist:false → copy new files, keep existing ones.
      await cp(srcMemory, path.join(rootDir, MEMORY_DIRNAME), {
        recursive: true,
        force: false,
        errorOnExist: false
      })
      copied.push(MEMORY_DIRNAME)
    }
  } catch (error) {
    logger.warn('Failed to import memory directory', { srcDir, rootDir, error })
  }

  return copied
}

/** Find an entry in `dir` matching `name` case-insensitively; returns its full path or undefined. */
async function resolveCaseInsensitive(dir: string, name: string): Promise<string | undefined> {
  const exact = path.join(dir, name)
  try {
    await stat(exact)
    return exact
  } catch {
    // exact match not found — fall through to a case-insensitive scan
  }
  try {
    const target = name.toLowerCase()
    const match = (await readdir(dir)).find((entry) => entry.toLowerCase() === target)
    return match ? path.join(dir, match) : undefined
  } catch {
    return undefined
  }
}
