/**
 * `.gitignore`-based ignore predicate for `DirectoryTreeBuilder`.
 *
 * Replaces a hardcoded `node_modules` / `.git` / `dist` / `.next` /
 * `coverage` list. The rationale is small: every Cherry workspace that
 * ever exhausts the chokidar FD limit already declares those names in its
 * `.gitignore`, and the few workspaces that don't (Notes data dir, fresh
 * empty workspace) carry no large `node_modules` to blow the limit
 * either. Reading the user's own ignore file keeps the policy
 * predictable — what git skips, the watcher skips.
 *
 * The `.git` directory is always added because git itself doesn't list
 * its own internal dir in `.gitignore`, but watching it is both pointless
 * and expensive (chokidar would open one FD per packed-ref / hooks /
 * objects subdir on every commit).
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import ignore, { type Ignore } from 'ignore'

const logger = loggerService.withContext('file/tree/gitignore')

export interface GitignorePredicate {
  /** True if the absolute path should be excluded from scan/watch. */
  (absPath: string): boolean
}

/**
 * Build a predicate from `${rootPath}/.gitignore`.
 *
 * Always returns at least a `.git`-only predicate; the result is `null`
 * **only** if the `ignore` library itself fails to construct. Callers
 * therefore cannot treat `null` as "no exclusion at all" — `.git` must
 * stay excluded regardless of whether the user's `.gitignore` parsed.
 *
 * A missing `.gitignore` is not an error (returns the `.git`-only
 * predicate). EACCES / EIO on the read is logged as a warning so the
 * operator can debug permission / filesystem problems, but the predicate
 * is still produced so `.git` stays excluded.
 *
 * Async by design: `.gitignore` may live on a slow filesystem (network
 * share, fuse, …), so callers must await this off the main-process event
 * loop rather than block startup with a sync read.
 */
export async function loadGitignorePredicate(rootPath: string): Promise<GitignorePredicate | null> {
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  let raw: string | null = null
  try {
    raw = await readFile(path.join(normalizedRoot, '.gitignore'), 'utf8')
  } catch (err) {
    // ENOENT = no `.gitignore` at all, which is expected and benign.
    // EACCES / EIO / other = the file exists but we couldn't read it;
    // worth logging so a confused operator (or a future incident) can
    // trace why `.gitignore` rules silently stopped applying.
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      logger.warn(`Could not read .gitignore under ${normalizedRoot} (${code ?? 'unknown'})`, err as Error)
    }
  }

  let ig: Ignore
  try {
    ig = ignore()
    if (raw) ig.add(raw)
    // `.git` is never listed in user .gitignore but we always skip it.
    ig.add('.git')
  } catch (err) {
    logger.warn(`Failed to parse .gitignore under ${normalizedRoot}`, err as Error)
    return null
  }

  return (absPath: string) => {
    const normalized = absPath.replace(/\\/g, '/')
    if (normalized === normalizedRoot) return false
    if (!normalized.startsWith(`${normalizedRoot}/`)) return false
    const rel = normalized.slice(normalizedRoot.length + 1)
    if (!rel) return false
    return ig.ignores(rel)
  }
}
