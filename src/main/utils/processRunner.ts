import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { type ChildProcess, execFile, spawn, type SpawnOptions } from 'child_process'
import crossSpawn from 'cross-spawn'
import path from 'path'

import { getShellEnv } from './shellEnv'

/**
 * Process execution helpers — spawning child processes with proper Windows
 * `.cmd`/quoting handling and encoding-aware output decoding. Consumes an env
 * (caller-supplied or the captured shell env); it never defines env policy.
 */

const logger = loggerService.withContext('Utils:ProcessRunner')

/**
 * Strip proxy-related variables from an environment map in place.
 * Used before spawning child processes that must not inherit Cherry's proxy
 * settings (e.g. Bun, which does not support HTTPS proxies).
 */
export const removeEnvProxy = (env: Record<string, string>) => {
  delete env.HTTPS_PROXY
  delete env.HTTP_PROXY
  delete env.grpc_proxy
  delete env.http_proxy
  delete env.https_proxy
}

export function runInstallScript(scriptPath: string, extraEnv?: Record<string, string>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const installScriptPath = path.join(application.getPath('app.root.resources.scripts'), scriptPath)
    logger.info(`Running script at: ${installScriptPath}`)

    const nodeProcess = spawn(process.execPath, [installScriptPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...extraEnv }
    })

    nodeProcess.stdout.on('data', (data) => {
      logger.debug(`Script output: ${data}`)
    })

    nodeProcess.stderr.on('data', (data) => {
      logger.error(`Script error: ${data}`)
    })

    nodeProcess.on('close', (code) => {
      if (code === 0) {
        logger.debug('Script completed successfully')
        resolve()
      } else {
        logger.warn(`Script exited with code ${code}`)
        reject(new Error(`Process exited with code ${code}`))
      }
    })
  })
}

/**
 * Spawn a process with cross-spawn's Windows `.cmd`/`.bat` handling.
 *
 * cross-spawn invokes batch shims through cmd.exe while quoting each argument,
 * unlike `shell: true`, which concatenates arbitrary arguments into one shell
 * command line. This boundary deliberately owns launch mechanics only; callers
 * continue to choose their execution environment.
 */
export function crossPlatformSpawn(
  command: string,
  args: string[],
  options: SpawnOptions & { env: NodeJS.ProcessEnv }
): ChildProcess {
  return crossSpawn(command, args, { ...options, windowsHide: true, stdio: options.stdio ?? 'pipe' })
}

/**
 * Force-kill a spawned child and any descendants.
 *
 * On Windows, `crossPlatformSpawn` runs non-`.exe` commands through `shell: true`
 * (cmd.exe), so a plain `child.kill()` only reaps the cmd.exe wrapper and leaves the
 * real process orphaned. `taskkill /T /F` terminates the whole tree by PID. On POSIX,
 * signalling the negative PID reaps the child's whole process group — but only if the
 * child was spawned `detached` (as its own group leader); otherwise the group send hits
 * ESRCH and we fall back to a direct `child.kill()`. Best-effort throughout: also falls
 * back when the pid is missing or taskkill is unavailable.
 */
export function killProcessTree(child: ChildProcess): void {
  if (isWin && child.pid) {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], (error) => {
      if (error) {
        // Usually the child already exited (a common cancel-after-finish race), so taskkill
        // reports "process not found" — debug, not warn, to avoid noise on normal cancels.
        logger.debug('taskkill did not terminate the process tree, falling back to child.kill()', error)
        child.kill()
      }
    })
    return
  }
  if (child.pid) {
    try {
      // Negative PID → signal the whole process group (the detached child is its group leader),
      // so descendants a plain child.kill() would orphan are terminated too.
      process.kill(-child.pid, 'SIGTERM')
      return
    } catch (error) {
      // No such group (child not detached, or already exited): fall back to a direct kill.
      logger.debug('Could not signal the process group, falling back to child.kill()', error as Error)
    }
  }
  child.kill()
}

/**
 * Execute a command and return its output.
 * Uses crossPlatformSpawn internally for proper Windows .cmd handling.
 * If no env is provided, automatically uses the shell environment.
 */
export async function executeCommand(
  command: string,
  args: string[],
  options?: {
    /** Capture and return stdout (default: false) */
    capture?: boolean
    /** Environment variables (defaults to getShellEnv()) */
    env?: NodeJS.ProcessEnv
    /** Timeout in milliseconds */
    timeout?: number
  }
): Promise<string> {
  const env = options?.env ?? (await getShellEnv())

  return new Promise<string>((resolve, reject) => {
    const child = crossPlatformSpawn(command, args, { env })
    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (options?.timeout) {
      timeoutId = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`Command timed out after ${options.timeout}ms`))
      }, options.timeout)
    }

    child.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId)
      reject(err)
    })

    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId)
      if (code === 0) {
        resolve(options?.capture ? stdout : '')
      } else {
        reject(new Error(stderr || `Command failed with code ${code}`))
      }
    })
  })
}
