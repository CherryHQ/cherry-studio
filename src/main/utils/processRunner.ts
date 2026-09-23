import { type ChildProcess, execFile, spawn, type SpawnOptions } from 'child_process'
import path from 'path'
import { promisify } from 'util'

import crossSpawn from 'cross-spawn'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'

import { getShellEnv } from './shellEnv'

const execFileAsync = promisify(execFile)

/**
 * Process execution helpers — spawning child processes with proper Windows
 * `.cmd`/quoting handling and encoding-aware output decoding. Consumes an env
 * (caller-supplied or the captured shell env); it never defines env policy.
 */

const logger = loggerService.withContext('Utils:ProcessRunner')

const PROXY_ENV_KEYS = new Set([
  'CHERRY_STUDIO_NODE_PROXY_RULES',
  'CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'SOCKS_PROXY',
  'NO_PROXY',
  'GRPC_PROXY'
])

/** Strip Cherry-managed proxy settings from an environment map in place. */
export const removeEnvProxy = (env: NodeJS.ProcessEnv) => {
  for (const key of Object.keys(env)) {
    if (PROXY_ENV_KEYS.has(key.toUpperCase())) {
      delete env[key]
    }
  }
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
 * Signal a spawned child's whole process tree, awaiting the signal's delivery.
 *
 * Unlike `killProcessTree` (fire-and-forget SIGTERM), this awaits `taskkill` so a
 * caller can pair it with `waitForProcessExit` for graceful-then-forced escalation.
 * `force=false` sends SIGTERM / `taskkill /T`; `force=true` sends SIGKILL /
 * `taskkill /T /F`. Best-effort: a graceful failure against a still-live tree is
 * logged (`label` names the owner in the warning) and a forced failure rethrows;
 * POSIX signals the negative PID (the detached child's process group) and swallows
 * ESRCH (the group is already gone).
 */
export async function terminateProcessTree(child: ChildProcess, force: boolean, label: string): Promise<void> {
  if (!child.pid) return
  if (isWin) {
    const args = ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])]
    await execFileAsync('taskkill', args, { windowsHide: true }).catch((error) => {
      if (child.exitCode !== null || child.signalCode !== null) return
      if (force) throw error
      logger.warn(`Failed to gracefully stop the managed ${label} process tree`, error as Error)
    })
    return
  }

  try {
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

/** Resolve true once the child exits within `timeoutMs` (or has already exited); false on timeout. */
export function waitForProcessExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off('exit', onClose)
      child.off('close', onClose)
      resolve(false)
    }, timeoutMs)
    const onClose = () => {
      clearTimeout(timeout)
      child.off('exit', onClose)
      child.off('close', onClose)
      resolve(true)
    }
    child.once('exit', onClose)
    child.once('close', onClose)
  })
}

interface ExecuteCommandOptions {
  /** Capture and return stdout in string mode (default: true) */
  capture?: boolean
  /** Environment variables (defaults to getShellEnv()) */
  env?: NodeJS.ProcessEnv
  cwd?: string
  /** UTF-8 input followed by EOF; omitted input still closes stdin */
  stdin?: string
  signal?: AbortSignal
  /** Maximum combined stdout/stderr bytes before the process tree is terminated */
  maxOutputBytes?: number
  /** Timeout in milliseconds, measured from process launch */
  timeout?: number
  result?: 'stdout' | 'structured'
}

export interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
  /** Combined stdout/stderr in the order received */
  output: string
  /** Launch, cancellation, timeout or I/O failure; nonzero exit alone is not a failure here */
  failure?: string
}

/** Rejection of `executeCommand` when output passes `maxOutputBytes`; the command has been killed. */
export class CommandOutputLimitError extends Error {
  constructor(maxOutputBytes: number) {
    super(`Command output exceeded ${maxOutputBytes} bytes`)
    this.name = 'CommandOutputLimitError'
  }
}

/**
 * Execute with cross-platform argument handling and bounded process-tree cleanup.
 * Default mode returns stdout (or an empty string for capture=false) and rejects on failure.
 * Structured mode returns output and exit/failure details instead, including nonzero exits.
 */
export function executeCommand(
  command: string,
  args: string[],
  options: ExecuteCommandOptions & { result: 'structured' }
): Promise<CommandResult>
export function executeCommand(
  command: string,
  args: string[],
  options?: ExecuteCommandOptions & { result?: 'stdout' }
): Promise<string>
export async function executeCommand(
  command: string,
  args: string[],
  options: ExecuteCommandOptions = {}
): Promise<string | CommandResult> {
  let env = options.env ?? {}
  if (!options.env && !options.signal?.aborted) {
    try {
      env = await getShellEnv(options.signal)
    } catch (error) {
      if (!options.signal?.aborted) throw error
    }
  }
  let outputLimitError: CommandOutputLimitError | undefined
  const result = await new Promise<CommandResult>((resolve) => {
    if (options.signal?.aborted) {
      resolve({ code: null, stdout: '', stderr: '', output: '', failure: 'Command execution was cancelled.' })
      return
    }
    const child = crossPlatformSpawn(command, args, { env, cwd: options.cwd, detached: !isWin })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const output: Buffer[] = []
    let outputBytes = 0
    let failure: string | undefined
    let settled = false
    let closed = false
    let stopping: Promise<void> | undefined
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      options.signal?.removeEventListener('abort', onAbort)
      child.stdin?.destroy()
      child.stdout?.destroy()
      child.stderr?.destroy()
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        output: Buffer.concat(output).toString('utf8'),
        failure
      })
    }
    const stop = (reason: string) => {
      if (settled) return
      failure ??= reason
      stopping ??= (async () => {
        try {
          if (child.pid) {
            await terminateProcessTree(child, true, 'command')
            if (!closed && !(await waitForProcessExit(child, 2000))) {
              logger.error('Command process did not exit', { pid: child.pid })
            }
          }
        } catch (error) {
          logger.error('Command process termination failed', { pid: child.pid, error })
        } finally {
          finish(null)
        }
      })()
    }
    const onAbort = () => stop('Command execution was cancelled.')
    const collectOutput = (chunk: Buffer, stream: Buffer[]) => {
      if (settled || stopping) return
      const remaining = options.maxOutputBytes === undefined ? chunk.length : options.maxOutputBytes - outputBytes
      if (remaining > 0) {
        const kept = chunk.subarray(0, remaining)
        stream.push(kept)
        output.push(kept)
      }
      outputBytes += chunk.length
      if (options.maxOutputBytes !== undefined && outputBytes > options.maxOutputBytes) {
        outputLimitError = new CommandOutputLimitError(options.maxOutputBytes)
        stop(outputLimitError.message)
      }
    }
    child.stdout?.on('data', (chunk: Buffer) => collectOutput(chunk, stdout))
    child.stderr?.on('data', (chunk: Buffer) => collectOutput(chunk, stderr))
    child.once('error', (error) => stop(error.message))
    child.once('close', (code) => {
      closed = true
      if (!stopping) finish(code)
    })
    child.stdin?.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') stop(error.message)
    })
    if (options.timeout) {
      timeoutId = setTimeout(() => stop(`Command timed out after ${options.timeout}ms`), options.timeout)
      timeoutId.unref?.()
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) onAbort()
    else child.stdin?.end(options.stdin)
  })

  if (options.result === 'structured') return result
  if (result.failure) throw outputLimitError ?? new Error(result.failure)
  if (result.code !== 0) throw new Error(result.stderr || `Command failed with code ${result.code}`)
  return options.capture !== false ? result.stdout : ''
}
