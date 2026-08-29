import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { chmod, type FileHandle, mkdtemp, open, rm } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

import { posixQuote } from './shellQuote'

const execFileAsync = promisify(execFile)
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const OPEN_RETRY_MS = 25
const DELIVERY_TIMEOUT_MS = 5 * 60_000

export interface SecretEnvHandoff {
  readonly pipePath: string
  wrapCommand(command: string): string
  deliver(): Promise<void>
  dispose(): Promise<void>
}

async function createNamedPipe(pipePath: string): Promise<void> {
  for (const executable of ['/usr/bin/mkfifo', '/bin/mkfifo']) {
    try {
      await execFileAsync(executable, [pipePath])
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  throw new Error('Unable to create the secure environment handoff pipe')
}

function validateEntries(env: Record<string, string>): Array<[string, string]> {
  const entries = Object.entries(env)
  if (entries.length === 0) throw new Error('Secret environment handoff requires at least one variable')

  for (const [key, value] of entries) {
    if (!ENV_NAME_PATTERN.test(key)) throw new Error(`Invalid secret environment variable name: ${key}`)
    if (value.includes('\0') || value.includes('\r') || value.includes('\n')) {
      throw new Error(`Secret environment variable ${key} contains an unsupported line break`)
    }
  }
  return entries
}

function isExpectedOpenError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENXIO' || code === 'ENOENT'
}

export async function createSecretEnvHandoff(tempRoot: string, env: Record<string, string>): Promise<SecretEnvHandoff> {
  const entries = validateEntries(env)
  const variableNames = entries.map(([key]) => key)
  let payload = `${entries.map(([key, value]) => `${key}=${value}`).join('\n')}\n`
  const handoffDir = await mkdtemp(path.join(tempRoot, 'secret-env-'))
  const pipePath = path.join(handoffDir, 'env')

  try {
    await chmod(handoffDir, 0o700)
    await createNamedPipe(pipePath)
    await chmod(pipePath, 0o600)
  } catch (error) {
    await rm(handoffDir, { recursive: true, force: true })
    throw error
  }

  const abortController = new AbortController()
  let writer: FileHandle | undefined
  let isDeliveryStarted = false
  let isDisposed = false
  let cleanupPromise: Promise<void> | undefined

  const cleanup = (): Promise<void> => {
    payload = ''
    cleanupPromise ??= rm(handoffDir, { recursive: true, force: true })
    return cleanupPromise
  }

  const dispose = async (): Promise<void> => {
    if (isDisposed) return cleanup()
    isDisposed = true
    abortController.abort()

    if (writer) {
      await writer.close().catch(() => undefined)
      writer = undefined
    } else {
      try {
        const readerRelease = await open(pipePath, constants.O_WRONLY | constants.O_NONBLOCK)
        await readerRelease.close()
      } catch (error) {
        if (!isExpectedOpenError(error)) {
          await cleanup()
          throw error
        }
      }
    }
    await cleanup()
  }

  const unsetCommand = `unset ${variableNames.join(' ')}`
  const readerCommand = `while IFS= read -r _cherry_secret_env; do export "$_cherry_secret_env"; done < ${posixQuote(pipePath)}`
  const presenceChecks = variableNames.map((name) => `[ "\${${name}+x}" = x ]`).join(' && ')
  const commandPrefix = `${unsetCommand} && ${readerCommand} && ${presenceChecks} && unset _cherry_secret_env`

  return {
    pipePath,
    wrapCommand(command: string): string {
      return `(set +x; ${commandPrefix} && ${command})`
    },
    async deliver(): Promise<void> {
      if (isDeliveryStarted) throw new Error('Secret environment handoff delivery already started')
      if (isDisposed) throw new Error('Secret environment handoff is already disposed')
      isDeliveryStarted = true
      const deadline = Date.now() + DELIVERY_TIMEOUT_MS

      try {
        while (!abortController.signal.aborted) {
          try {
            writer = await open(pipePath, constants.O_WRONLY | constants.O_NONBLOCK)
            break
          } catch (error) {
            if (!isExpectedOpenError(error)) throw error
            if (Date.now() >= deadline) throw new Error('Timed out waiting for the terminal to read its environment')
            await delay(OPEN_RETRY_MS, undefined, { signal: abortController.signal, ref: false })
          }
        }

        if (!writer || abortController.signal.aborted) return
        await writer.writeFile(payload, 'utf8')
      } catch (error) {
        if (!abortController.signal.aborted) throw error
      } finally {
        await writer?.close().catch(() => undefined)
        writer = undefined
        isDisposed = true
        await cleanup()
      }
    },
    dispose
  }
}
