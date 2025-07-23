import { loggerService } from '@logger'
import { spawn } from 'child_process'
import os from 'os'

const logger = loggerService.withContext('ShellEnv')

/**
 * Spawns a login shell in the user's home directory to capture its environment variables.
 * @returns {Promise<Object>} A promise that resolves with an object containing
 * the environment variables, or rejects with an error.
 */
function getLoginShellEnvironment(): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const homeDirectory = os.homedir()
    if (!homeDirectory) {
      return reject(new Error("Could not determine user's home directory."))
    }

    let shellPath = process.env.SHELL
    let commandArgs
    let shellCommandToGetEnv

    const platform = os.platform()

    if (platform === 'win32') {
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
        // Defaulting to bash, but this might not be the user's actual login shell.
        // A more robust solution might involve checking /etc/passwd or similar,
        // but that's more complex and often requires higher privileges or native modules.
        logger.warn("process.env.SHELL is not set. Defaulting to /bin/bash. This might not be the user's login shell.")
        shellPath = '/bin/bash' // A common default
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

    const child = spawn(shellPath, commandArgs, {
      cwd: homeDirectory, // Run the command in the user's home directory
      detached: true, // Allows the parent to exit independently of the child
      stdio: ['ignore', 'pipe', 'pipe'], // stdin, stdout, stderr
      shell: false // We are specifying the shell command directly
    })

    let output = ''
    let errorOutput = ''

    child.stdout.on('data', (data) => {
      output += data.toString()
    })

    child.stderr.on('data', (data) => {
      errorOutput += data.toString()
    })

    child.on('error', (error) => {
      logger.error(`Failed to start shell process: ${shellPath}`, error)
      reject(new Error(`Failed to start shell: ${error.message}`))
    })

    child.on('close', (code) => {
      if (code !== 0) {
        const errorMessage = `Shell process exited with code ${code}. Shell: ${shellPath}. Args: ${commandArgs.join(' ')}. CWD: ${homeDirectory}. Stderr: ${errorOutput.trim()}`
        logger.error(errorMessage)
        return reject(new Error(errorMessage))
      }

      if (errorOutput.trim()) {
        // Some shells might output warnings or non-fatal errors to stderr
        // during profile loading. Log it, but proceed if exit code is 0.
        logger.warn(`Shell process stderr output (even with exit code 0):\n${errorOutput.trim()}`)
      }

      const env: Record<string, string> = {}
      const lines = output.split('\n')

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

      env.PATH = env.Path || env.PATH || ''

      resolve(env)
    })
  })
}

export default getLoginShellEnvironment
