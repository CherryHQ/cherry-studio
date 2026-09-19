import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'

import type { NativeRequest, NativeResponse, NativeSuccess, SystemSpeechErrorCode } from './contracts'
import { speechError, throwIfAborted } from './contracts'

const MAX_STDOUT_BYTES = 1024 * 1024
const MAX_ERROR_MESSAGE_BYTES = 4096
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_KILL_GRACE_MS = 2_000

export interface SystemSpeechNativeClientOptions {
  helperPath: string
  timeoutMs?: number
  killGraceMs?: number
  launcher?: { executable: string; args: readonly string[] }
}

export class SystemSpeechNativeClient {
  readonly #options: SystemSpeechNativeClientOptions

  constructor(options: SystemSpeechNativeClientOptions) {
    this.#options = options
  }

  async request(request: NativeRequest, options: { signal?: AbortSignal } = {}): Promise<NativeSuccess> {
    throwIfAborted(options.signal)
    await this.#validateHelper()
    throwIfAborted(options.signal)

    const executable = this.#options.launcher?.executable ?? this.#options.helperPath
    const args = this.#options.launcher ? [...this.#options.launcher.args, this.#options.helperPath] : []
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] })

    return new Promise<NativeSuccess>((resolve, reject) => {
      const chunks: Buffer[] = []
      let stdoutBytes = 0
      let stderr = Buffer.alloc(0)
      let settled = false
      let killTimer: ReturnType<typeof setTimeout> | undefined

      const timeout = setTimeout(() => {
        terminate()
        finish(() => reject(speechError('native_helper_failed')))
      }, this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

      const finish = (complete: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        options.signal?.removeEventListener('abort', abort)
        complete()
      }

      const terminate = () => {
        child.kill('SIGTERM')
        killTimer ??= setTimeout(() => child.kill('SIGKILL'), this.#options.killGraceMs ?? DEFAULT_KILL_GRACE_MS)
      }

      const abort = () => {
        terminate()
        finish(() => reject(speechError('cancelled', options.signal?.reason)))
      }

      options.signal?.addEventListener('abort', abort, { once: true })

      child.stdout.on('data', (chunk: Buffer) => {
        if (settled) return
        stdoutBytes += chunk.length
        if (stdoutBytes > MAX_STDOUT_BYTES) {
          terminate()
          finish(() => reject(speechError('native_helper_failed')))
          return
        }
        chunks.push(chunk)
      })

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length >= MAX_ERROR_MESSAGE_BYTES) return
        stderr = Buffer.concat([stderr, chunk]).subarray(0, MAX_ERROR_MESSAGE_BYTES)
      })

      child.once('error', (error) => {
        finish(() => reject(speechError('native_helper_failed', error)))
      })

      child.once('close', (code) => {
        if (killTimer) clearTimeout(killTimer)
        if (settled) return
        if (code !== 0) {
          const message = stderr.toString('utf8').trim().slice(0, MAX_ERROR_MESSAGE_BYTES)
          finish(() => reject(speechError('native_helper_failed', message || undefined)))
          return
        }

        try {
          const response: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (!isNativeResponse(response)) throw new Error('Invalid native helper response')
          if (!response.ok) {
            finish(() => reject(speechError(response.error.code, response.error.message)))
            return
          }
          finish(() => resolve(response.value))
        } catch (error) {
          finish(() => reject(speechError('native_helper_failed', error)))
        }
      })

      if (options.signal?.aborted) {
        abort()
        return
      }
      child.stdin.end(`${JSON.stringify(request)}\n`)
    })
  }

  async #validateHelper(): Promise<void> {
    try {
      const helper = await stat(this.#options.helperPath)
      if (!helper.isFile() || (helper.mode & 0o100) === 0) throw new Error('Helper is not owner-executable')
    } catch (error) {
      throw speechError('native_helper_failed', error)
    }
  }
}

const errorCodes = new Set<SystemSpeechErrorCode>([
  'unsupported_os',
  'unsupported_locale',
  'asset_required',
  'asset_installation_failed',
  'voice_unavailable',
  'unsupported_recording_format',
  'audio_decode_failed',
  'audio_conversion_failed',
  'transcription_failed',
  'synthesis_failed',
  'cancelled',
  'invalid_request',
  'native_helper_failed'
])

function isNativeResponse(value: unknown): value is NativeResponse {
  if (!value || typeof value !== 'object' || !('ok' in value)) return false
  if (value.ok === true) return 'value' in value && isNativeSuccess(value.value)
  if (value.ok !== false || !('error' in value) || !value.error || typeof value.error !== 'object') return false
  return (
    'code' in value.error &&
    typeof value.error.code === 'string' &&
    errorCodes.has(value.error.code as SystemSpeechErrorCode) &&
    'message' in value.error &&
    typeof value.error.message === 'string'
  )
}

function isNativeSuccess(value: unknown): value is NativeSuccess {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'operation' in value &&
    typeof value.operation === 'string' &&
    'result' in value &&
    value.result &&
    typeof value.result === 'object'
  )
}
