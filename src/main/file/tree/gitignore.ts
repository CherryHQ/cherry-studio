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

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import ignore, { type Ignore } from 'ignore'

const logger = loggerService.withContext('file/tree/gitignore')

export interface GitignorePredicate {
  /** True if the absolute path should be excluded from scan/watch. */
  (absPath: string): boolean
}

/**
 * Build a predicate from `${rootPath}/.gitignore`. Returns `null` when
 * the file is unreadable / missing — callers should treat that as "no
 * gitignore-driven exclusion" and fall back to their existing behavior.
 */
export function loadGitignorePredicate(rootPath: string): GitignorePredicate | null {
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  let raw: string | null = null
  try {
    raw = readFileSync(path.join(normalizedRoot, '.gitignore'), 'utf8')
  } catch {
    // No `.gitignore` (or unreadable): caller still wants the `.git`
    // exclusion even without user rules — return a thin predicate that
    // only filters that.
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
