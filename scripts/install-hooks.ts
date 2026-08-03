import { execFileSync } from 'node:child_process'
import { normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Windows path comparison requires case-insensitive matching
const isWindows: boolean = process.platform === 'win32'

function arePathsEqual(a: string, b: string): boolean {
  const na = normalize(resolve(a))
  const nb = normalize(resolve(b))
  return isWindows ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

/**
 * Cross-platform check for whether this module was invoked directly
 * (not imported by a test file). Compares normalized absolute paths
 * from `import.meta.url` and `process.argv[1]`.
 */
function isDirectRun(): boolean {
  try {
    const modulePath = fileURLToPath(import.meta.url)
    const scriptPath = process.argv[1] ?? ''
    return arePathsEqual(modulePath, scriptPath)
  } catch {
    return false
  }
}

function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn('install-hooks: git not found on PATH — hook setup will be skipped')
    }
    return null
  }
}

function isGitRepo(): boolean {
  return git('rev-parse', '--git-dir') !== null
}

/**
 * Detect linked worktree status by comparing git-dir and git-common-dir.
 * Returns true if linked, false if primary, null if detection failed.
 */
function isLinkedWorktree(): boolean | null {
  const gitDir = git('rev-parse', '--absolute-git-dir')
  const commonDir = git('rev-parse', '--git-common-dir')
  if (!gitDir || !commonDir) return null
  const a = normalize(resolve(gitDir))
  const b = normalize(resolve(commonDir))
  return isWindows ? a.toLowerCase() !== b.toLowerCase() : a !== b
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

/**
 * Check if hooksPath points to the Git default hooks directory.
 * On Windows, comparison is case-insensitive.
 */
function isDefaultGitHooksPath(hooksPath: string): boolean {
  const defaultDir = getDefaultHooksDir()
  if (!defaultDir) return false
  const resolved = normalize(resolve(hooksPath))
  return isWindows ? resolved.toLowerCase() === defaultDir.toLowerCase() : resolved === defaultDir
}

/**
 * Unset local core.hooksPath. Returns true if unset succeeded
 * or hooksPath was not set, false if the git command itself failed.
 */
function unsetHooksPath(): boolean {
  const result = git('config', '--local', '--unset-all', 'core.hooksPath')
  return result !== null
}

type PrekResult = 'success' | 'command-not-found' | 'failed'

/**
 * Execute prek install via the current package manager.
 * Returns 'success' on success, 'command-not-found' when the binary
 * is missing, or 'failed' for any other error (including prek refusal).
 */
function runPrekInstall(): PrekResult {
  const execPath = process.env.npm_execpath
  const args = ['exec', 'prek', 'install']

  try {
    if (execPath) {
      execFileSync(process.execPath, [resolve(execPath), ...args], {
        stdio: 'inherit'
      })
    } else {
      execFileSync('pnpm', args, { stdio: 'inherit', shell: isWindows })
    }
    return 'success'
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      const cmd = execPath ? process.execPath : 'pnpm'
      console.error(`install-hooks: command not found: ${cmd}`)
      return 'command-not-found'
    }
    return 'failed'
  }
}

/**
 * Main entry point for the prepare lifecycle script.
 * Handles worktree detection, hooksPath cleanup, and prek install.
 */
function main(): void {
  if (!isGitRepo()) {
    console.warn('install-hooks: not a git repository, skipping hook setup')
    return
  }
  configureBlameIgnoreRevs()

  // Linked worktree: skip prek install entirely
  const linked = isLinkedWorktree()
  if (linked === null) {
    // Cannot determine worktree status — abort rather than risk polluting shared hooks
    console.error('install-hooks: could not determine worktree status, aborting hook setup')
    process.exit(1)
  }
  if (linked) {
    console.info('install-hooks: linked worktree detected, skipping prek install (hooks managed by primary worktree)')
    return
  }

  // Primary worktree: clean default hooksPath if present
  const hooksPath = getLocalHooksPath()
  if (hooksPath && isDefaultGitHooksPath(hooksPath)) {
    if (!unsetHooksPath()) {
      console.error('install-hooks: failed to unset core.hooksPath, aborting hook setup')
      process.exit(1)
    }
    console.info('install-hooks: cleaned default core.hooksPath')
  }

  // Install hooks
  const hooksPathBeforeInstall = getLocalHooksPath()
  const result = runPrekInstall()
  if (result === 'command-not-found') {
    console.error('install-hooks: aborting — package manager not found')
    process.exit(1)
  }
  if (result === 'failed') {
    // prek may refuse when custom hooksPath is set (e.g. .husky) — acceptable
    if (hooksPathBeforeInstall) {
      console.info(`install-hooks: prek skipped (core.hooksPath is set to "${hooksPathBeforeInstall}")`)
    } else {
      console.error('install-hooks: prek install failed unexpectedly')
      process.exit(1)
    }
  }
}

if (isDirectRun()) {
  main()
}

// Export for testing
export {
  arePathsEqual,
  configureBlameIgnoreRevs,
  getDefaultHooksDir,
  getLocalHooksPath,
  git,
  isDefaultGitHooksPath,
  isDirectRun,
  isGitRepo,
  isLinkedWorktree,
  isWindows,
  main,
  runPrekInstall,
  unsetHooksPath
}
