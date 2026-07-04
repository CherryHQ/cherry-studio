import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { type ChildProcess, spawn, type SpawnOptions } from 'child_process'
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
 * Spawn a process with proper Windows handling for .cmd files and npm shims.
 * On Windows, .cmd/.bat files need `shell: true` so Node.js delegates quoting
 * to cmd.exe via `/d /s /c "..."`. Manually constructing `cmd.exe /c` args
 * breaks when both the command path and arguments contain spaces (cmd.exe's
 * quote-stripping rule 2 kicks in and mangles the command line).
 */
export function crossPlatformSpawn(
  command: string,
  args: string[],
  options: SpawnOptions & { env: Record<string, string> }
): ChildProcess {
  // Always hide console window on Windows
  const baseOptions: SpawnOptions = { ...options, windowsHide: true, stdio: options.stdio ?? 'pipe' }

  if (isWin && !command.toLowerCase().endsWith('.exe')) {
    // When shell: true, Node passes the command to cmd.exe as:
    //   cmd /d /s /c "command arg1 arg2"
    // If the command path contains spaces (e.g. C:\Program Files\nodejs\npm.cmd),
    // cmd.exe splits on the space. Wrapping in quotes fixes this:
    //   cmd /d /s /c ""C:\Program Files\nodejs\npm.cmd" arg1 arg2"
    const quotedCommand = command.includes(' ') && !command.startsWith('"') ? `"${command}"` : command
    return spawn(quotedCommand, args, { ...baseOptions, shell: true })
  }
  return spawn(command, args, baseOptions)
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
    env?: Record<string, string>
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
