import os from 'node:os'
import path from 'node:path'

import { loggerService } from '@logger'
import { isMac, isWin } from '@main/constant'
import { spawn } from 'child_process'
import { memoize } from 'lodash'

const logger = loggerService.withContext('ShellEnv')

// Give shells enough time to source profile files, but fail fast when they hang.
const SHELL_ENV_TIMEOUT_MS = 15_000

/**
 * Ensures the Cherry Studio bin directory is appended to the user's PATH while
 * preserving the original key casing and avoiding duplicate segments.
 */
const appendCherryBinToPath = (env: Record<string, string>) => {
  const pathSeparator = isWin ? ';' : ':'
  const homeDirFromEnv = env.HOME || env.Home || env.USERPROFILE || env.UserProfile || os.homedir()
  const cherryBinPath = path.join(homeDirFromEnv, '.cherrystudio', 'bin')
  const pathKeys = Object.keys(env).filter((key) => key.toLowerCase() === 'path')
  const canonicalPathKey = pathKeys[0] || (isWin ? 'Path' : 'PATH')
  const existingPathValue = env[canonicalPathKey] || env.PATH || ''

  const normaliseSegment = (segment: string) => {
    const normalized = path.normalize(segment)
    return isWin ? normalized.toLowerCase() : normalized
  }

  const uniqueSegments: string[] = []
  const seenSegments = new Set<string>()
  const pushIfUnique = (segment: string) => {
    if (!segment) {
      return
    }
    const canonicalSegment = normaliseSegment(segment)
    if (!seenSegments.has(canonicalSegment)) {
      seenSegments.add(canonicalSegment)
      uniqueSegments.push(segment)
    }
  }

  existingPathValue
    .split(pathSeparator)
    .map((segment) => segment.trim())
    .forEach(pushIfUnique)

  pushIfUnique(cherryBinPath)

  const updatedPath = uniqueSegments.join(pathSeparator)

  if (pathKeys.length > 0) {
    pathKeys.forEach((key) => {
      env[key] = updatedPath
    })
  } else {
    env[canonicalPathKey] = updatedPath
  }

  if (!isWin) {
    env.PATH = updatedPath
  }
}

/**
 * Spawns a login shell in the user's home directory to capture its environment variables.
 *
 * We explicitly run a login + interactive shell so it sources the same init files that a user
 * would typically rely on inside their terminal. Many CLIs export PATH or other variables from
 * these scripts; capturing them keeps spawned processes aligned with the user’s expectations.
 *
 * Timeout handling is important because profile scripts might block forever (e.g. misconfigured
 * `read` or prompts). We proactively kill the shell and surface an error in that case so that
 * the app does not hang.
 * @returns {Promise<Object>} A promise that resolves with an object containing
 * the environment variables, or rejects with an error.
 */
function getLoginShellEnvironment(): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const homeDirectory =
      process.env.HOME || process.env.Home || process.env.USERPROFILE || process.env.UserProfile || os.homedir()
    if (!homeDirectory) {
      return reject(new Error("Could not determine user's home directory."))
    }

    let shellPath = process.env.SHELL
    let commandArgs
    let shellCommandToGetEnv

    if (isWin) {
      // On Windows, 'cmd.exe' is the common shell.
      // The 'set' command lists environment variables.
      // We don't typically talk about "login shells" in the same way,
      // but cmd will load the user's environment.
      shellPath = process.env.COMSPEC || 'cmd.exe'
      shellCommandToGetEnv = 'set'
      commandArgs = ['/c', shellCommandToGetEnv] // /c Carries out the command specified by string and then terminates
    } else {
      // For POSIX systems (Linux, macOS)
      if (!shellPath) {
        // Fallback if process.env.SHELL is not set (less common for interactive users)
        // A more robust solution might involve checking /etc/passwd or similar,
        // but that's more complex and often requires higher privileges or native modules.
        if (isMac) {
          // macOS defaults to zsh since Catalina (10.15)
          logger.warn(
            "process.env.SHELL is not set. Defaulting to /bin/zsh for macOS. This might not be the user's login shell."
          )
          shellPath = '/bin/zsh'
        } else {
          // Other POSIX systems (Linux) default to bash
          logger.warn(
            "process.env.SHELL is not set. Defaulting to /bin/bash. This might not be the user's login shell."
          )
          shellPath = '/bin/bash'
        }
      }
      // -l: Make it a login shell. This sources profile files like .profile, .bash_profile, .zprofile etc.
      // -i: Make it interactive. Some shells or profile scripts behave differently.
      // 'env': The command to print environment variables.
      // Using 'env -0' would be more robust for parsing if values contain newlines,
      // but requires splitting by null character. For simplicity, we'll use 'env'.
      shellCommandToGetEnv = 'env'
      commandArgs = ['-ilc', shellCommandToGetEnv] // -i for interactive, -l for login, -c to execute command
    }

    logger.debug(`Spawning shell: ${shellPath} with args: ${commandArgs.join(' ')} in ${homeDirectory}`)

    let settled = false
    let timeoutId: NodeJS.Timeout | undefined

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = undefined
      }
    }

    const resolveOnce = (value: Record<string, string>) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(value)
    }

    const rejectOnce = (error: Error) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    }

    const child = spawn(shellPath, commandArgs, {
      cwd: homeDirectory, // Run the command in the user's home directory
      detached: false, // Stay attached so we can clean up reliably
      stdio: ['ignore', 'pipe', 'pipe'], // stdin, stdout, stderr
      shell: false // We are specifying the shell command directly
    })

    let output = ''
    let errorOutput = ''

    // Protects against shells that wait for user input or hang during profile sourcing.
    timeoutId = setTimeout(() => {
      const errorMessage = `Timed out after ${SHELL_ENV_TIMEOUT_MS}ms while retrieving shell environment. Shell: ${shellPath}. Args: ${commandArgs.join(
        ' '
      )}. CWD: ${homeDirectory}`
      logger.error(errorMessage)
      child.kill()
      rejectOnce(new Error(errorMessage))
    }, SHELL_ENV_TIMEOUT_MS)

    child.stdout.on('data', (data) => {
      output += data.toString()
    })

    child.stderr.on('data', (data) => {
      errorOutput += data.toString()
    })

    child.on('error', (error) => {
      logger.error(`Failed to start shell process: ${shellPath}`, error)
      rejectOnce(new Error(`Failed to start shell: ${error.message}`))
    })

    child.on('close', (code) => {
      if (settled) {
        return
      }

      if (code !== 0) {
        const errorMessage = `Shell process exited with code ${code}. Shell: ${shellPath}. Args: ${commandArgs.join(' ')}. CWD: ${homeDirectory}. Stderr: ${errorOutput.trim()}`
        logger.error(errorMessage)
        return rejectOnce(new Error(errorMessage))
      }

      if (errorOutput.trim()) {
        // Some shells might output warnings or non-fatal errors to stderr
        // during profile loading. Log it, but proceed if exit code is 0.
        logger.warn(`Shell process stderr output (even with exit code 0):\n${errorOutput.trim()}`)
      }

      // Convert each VAR=VALUE line into our env map.
      const env: Record<string, string> = {}
      const lines = output.split(/\r?\n/)

      lines.forEach((line) => {
        const trimmedLine = line.trim()
        if (trimmedLine) {
          const separatorIndex = trimmedLine.indexOf('=')
          if (separatorIndex > 0) {
            // Ensure '=' is present and it's not the first character
            const key = trimmedLine.substring(0, separatorIndex)
            const value = trimmedLine.substring(separatorIndex + 1)
            env[key] = value
          }
        }
      })

      if (Object.keys(env).length === 0 && output.length < 100) {
        // Arbitrary small length check
        // This might indicate an issue if no env vars were parsed or output was minimal
        logger.warn(
          'Parsed environment is empty or output was very short. This might indicate an issue with shell execution or environment variable retrieval.'
        )
        logger.warn(`Raw output from shell:\n${output}`)
      }

      appendCherryBinToPath(env)

      resolveOnce(env)
    })
  })
}

const memoizedGetShellEnvs = memoize(async () => {
  try {
    return await getLoginShellEnvironment()
  } catch (error) {
    logger.error('Failed to get shell environment, falling back to process.env', { error })
    // Fallback to current process environment with cherry studio bin path
    const fallbackEnv: Record<string, string> = {}
    for (const key in process.env) {
      fallbackEnv[key] = process.env[key] || ''
    }
    appendCherryBinToPath(fallbackEnv)
    return fallbackEnv
  }
})

export default memoizedGetShellEnvs

export const refreshShellEnvCache = () => {
  memoizedGetShellEnvs.cache.clear?.()
}
