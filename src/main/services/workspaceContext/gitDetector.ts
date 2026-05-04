/**
 * Probe a directory for git state. Returns `null` when the directory
 * isn't a git repository (no `.git` ancestor reachable). Probes via
 * `git` CLI rather than parsing `.git/HEAD` ourselves so worktrees,
 * submodules, and detached HEAD all behave naturally.
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'

import { loggerService } from '@logger'

const logger = loggerService.withContext('gitDetector')
const execAsync = promisify(exec)

export interface GitState {
  branch: string | null // null when HEAD is detached
  isClean: boolean
  ahead: number
  behind: number
}

const GIT_TIMEOUT_MS = 1500

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execAsync(`git ${args.join(' ')}`, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    encoding: 'utf8'
  })
  return stdout.trim()
}

export async function detectGitState(cwd: string): Promise<GitState | null> {
  try {
    // `rev-parse --is-inside-work-tree` is the cheapest way to confirm
    // the dir is tracked by git; bail before doing anything else if not.
    const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
    if (inside !== 'true') return null

    const [branchRaw, statusRaw, aheadBehindRaw] = await Promise.all([
      runGit(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => ''),
      runGit(cwd, ['status', '--porcelain']).catch(() => ''),
      runGit(cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD']).catch(() => '')
    ])

    const branch = branchRaw || null
    const isClean = statusRaw.length === 0

    let ahead = 0
    let behind = 0
    if (aheadBehindRaw) {
      // Output: "<behind>\t<ahead>" (left = upstream, right = HEAD)
      const [b, a] = aheadBehindRaw.split(/\s+/).map((n) => Number.parseInt(n, 10))
      if (Number.isFinite(b)) behind = b
      if (Number.isFinite(a)) ahead = a
    }

    return { branch, isClean, ahead, behind }
  } catch (err) {
    logger.debug('git detect failed', { cwd, error: String(err) })
    return null
  }
}
