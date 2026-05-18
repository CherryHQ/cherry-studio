import { execFileSync } from 'node:child_process'
import { normalize, resolve } from 'node:path'

/**
 * Prepare script for git hook installation.
 *
 * Handles three scenarios:
 * 1. Linked worktree → skip prek install (hooks shared via commondir)
 * 2. Primary worktree with Claude Code hooksPath pollution → clean up, then install
 * 3. Primary worktree, normal → install hooks normally
 */

// Run a git command and return trimmed stdout, or null on failure
function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return null
  }
}

// Check if current directory is inside a git repository
function isGitRepo(): boolean {
  return git('rev-parse', '--git-dir') !== null
}

// Check if running inside a linked worktree (git-dir !== git-common-dir)
function isLinkedWorktree(): boolean {
  const gitDir = git('rev-parse', '--absolute-git-dir')
  const commonDir = git('rev-parse', '--git-common-dir')
  if (!gitDir || !commonDir) return false
  return normalize(resolve(gitDir)) !== normalize(resolve(commonDir))
}

// Set blame.ignoreRevsFile (best-effort, non-fatal)
function configureBlameIgnoreRevs(): void {
  const result = git('config', 'blame.ignoreRevsFile', '.git-blame-ignore-revs')
  if (result === null) {
    console.warn('install-hooks: could not set blame.ignoreRevsFile (non-fatal)')
  }
}

// Get the local core.hooksPath, or null if not set
function getLocalHooksPath(): string | null {
  return git('config', '--local', '--get', 'core.hooksPath')
}

// Compute the default hooks directory (<git-common-dir>/hooks)
function getDefaultHooksDir(): string | null {
  const commonDir = git('rev-parse', '--git-common-dir')
  if (!commonDir) return null
  return normalize(resolve(commonDir, 'hooks'))
}

// Check if hooksPath is the Git default hooks directory (Claude Code pollution)
function isClaudeCodeHooksPath(hooksPath: string): boolean {
  const defaultDir = getDefaultHooksDir()
  if (!defaultDir) return false
  return normalize(resolve(hooksPath)) === defaultDir
}

// Unset local core.hooksPath
function unsetHooksPath(): void {
  git('config', '--local', '--unset-all', 'core.hooksPath')
}

// Execute prek install via the current package manager
function runPrekInstall(): void {
  const execPath = process.env.npm_execpath
  const args = ['exec', 'prek', 'install']

  if (execPath) {
    execFileSync(process.execPath, [resolve(execPath), ...args], {
      stdio: 'inherit'
    })
  } else {
    // Fallback: try pnpm directly
    execFileSync('pnpm', args, { stdio: 'inherit' })
  }
}

// Main
function main(): void {
  // Best-effort blame config
  if (!isGitRepo()) {
    console.warn('install-hooks: not a git repository, skipping hook setup')
    return
  }
  configureBlameIgnoreRevs()

  // Linked worktree: skip prek install entirely
  if (isLinkedWorktree()) {
    console.info('install-hooks: linked worktree detected, skipping prek install (hooks managed by primary worktree)')
    return
  }

  // Primary worktree: clean Claude Code hooksPath pollution if present
  const hooksPath = getLocalHooksPath()
  if (hooksPath && isClaudeCodeHooksPath(hooksPath)) {
    unsetHooksPath()
    console.info('install-hooks: cleaned Claude Code core.hooksPath pollution')
  }

  // Install hooks
  runPrekInstall()
}

main()
