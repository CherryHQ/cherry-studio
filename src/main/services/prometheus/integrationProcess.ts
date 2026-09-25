import { spawn, type ChildProcess } from 'node:child_process'

import { application } from '@application'
import { getBinarySearchDirs, mergeBinaryExecutionEnv, mergePathPrefixes } from '@main/utils/binaryEnv'

const OUTPUT_TAIL_LIMIT = 262_144

export class IntegrationProcessError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null
  ) {
    super(message)
    this.name = 'IntegrationProcessError'
  }
}

class StreamingRedactor {
  private pending = ''
  private readonly secrets: string[]

  constructor(secrets: string[]) {
    this.secrets = [...new Set(secrets.filter(Boolean))].sort((left, right) => right.length - left.length)
  }

  write(value: string): string {
    this.pending += value
    this.pending = redactIntegrationText(this.pending, this.secrets)
    let safeLength = this.pending.length
    for (const secret of this.secrets) {
      const maximum = Math.min(secret.length - 1, this.pending.length)
      for (let length = maximum; length > 0; length--) {
        if (this.pending.endsWith(secret.slice(0, length))) {
          safeLength = Math.min(safeLength, this.pending.length - length)
          break
        }
      }
    }
    const ready = this.pending.slice(0, safeLength)
    this.pending = this.pending.slice(safeLength)
    return ready
  }

  end(): string {
    const ready = redactIntegrationText(this.pending, this.secrets)
    this.pending = ''
    return ready
  }
}

export function redactIntegrationText(value: string, secrets: string[]): string {
  return secrets.filter(Boolean).reduce((text, secret) => text.split(secret).join('[redacted]'), value)
}

function abortError(): Error {
  const error = new Error('Operation cancelled')
  error.name = 'AbortError'
  return error
}

async function terminateWindowsTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return
  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      shell: false,
      stdio: 'ignore'
    })
    killer.once('error', () => {
      child.kill()
      resolve()
    })
    killer.once('close', (code) => {
      if (code !== 0) child.kill()
      resolve()
    })
  })
}

function terminatePosixTree(child: ChildProcess): NodeJS.Timeout | undefined {
  if (!child.pid) return undefined
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  const force = setTimeout(() => {
    try {
      process.kill(-child.pid!, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }, 5_000)
  force.unref()
  return force
}

export function runIntegrationProcess(
  command: string,
  args: string[],
  options: {
    cwd?: string
    env?: Record<string, string>
    signal?: AbortSignal
    onOutput?: (output: string) => void
    secrets?: string[]
  } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError())
      return
    }
    const env = mergeBinaryExecutionEnv(
      mergePathPrefixes(
        Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
        ),
        [application.getPath('feature.prometheus.commands'), ...getBinarySearchDirs()]
      )
    )
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...env, ...options.env },
      detached: process.platform !== 'win32',
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const redactor = new StreamingRedactor(options.secrets ?? [])
    let output = ''
    let aborted = false
    let forceTimer: NodeJS.Timeout | undefined
    let settled = false
    const emit = (value: string) => {
      if (!value) return
      output = (output + value).slice(-OUTPUT_TAIL_LIMIT)
      options.onOutput?.(value)
    }
    const append = (chunk: Buffer) => emit(redactor.write(chunk.toString()))
    const onAbort = () => {
      if (aborted) return
      aborted = true
      if (process.platform === 'win32') void terminateWindowsTree(child)
      else forceTimer = terminatePosixTree(child)
    }
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      if (forceTimer) clearTimeout(forceTimer)
      options.signal?.removeEventListener('abort', onAbort)
      emit(redactor.end())
      if (error) reject(error)
      else resolve(output)
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) onAbort()
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', (error) => finish(aborted ? abortError() : error))
    child.once('close', (code) => {
      if (aborted) finish(abortError())
      else if (code === 0) finish()
      else finish(new IntegrationProcessError(output || `Process exited with code ${code}`, code))
    })
  })
}
