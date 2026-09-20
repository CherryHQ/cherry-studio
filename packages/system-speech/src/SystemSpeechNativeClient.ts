import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'

import {
  type NativeRequest,
  type NativeSuccess,
  nativeResponseSchema,
  SystemSpeechError,
  type SystemSpeechErrorCode
} from './contracts'

export interface SystemSpeechNativeClientOptions {
  helperPath: string
  timeoutMs?: number
  killGraceMs?: number
}

export class SystemSpeechNativeClient {
  constructor(private readonly options: SystemSpeechNativeClientOptions) {}

  async request<Request extends NativeRequest>(
    request: Request,
    options: { signal?: AbortSignal } = {}
  ): Promise<Extract<NativeSuccess, { operation: Request['operation'] }>> {
    if (options.signal?.aborted) throw new SystemSpeechError('cancelled')
    try {
      const helper = await stat(this.options.helperPath)
      if (!helper.isFile() || (helper.mode & 0o100) === 0) throw new SystemSpeechError('native_helper_failed')
    } catch {
      throw new SystemSpeechError('native_helper_failed')
    }
    if (options.signal?.aborted) throw new SystemSpeechError('cancelled')

    const child = spawn(this.options.helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let bytes = 0
      let failure: SystemSpeechErrorCode | undefined
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const terminate = (code: SystemSpeechErrorCode) => {
        if (failure) return
        failure = code
        child.kill('SIGTERM')
        killTimer = setTimeout(() => child.kill('SIGKILL'), this.options.killGraceMs ?? 2000)
      }
      const abort = () => terminate('cancelled')
      const timeout = setTimeout(() => terminate('timeout'), this.options.timeoutMs ?? 120_000)
      options.signal?.addEventListener('abort', abort, { once: true })
      child.stderr.resume()
      child.stdout.on('data', (chunk: Buffer) => {
        if (failure) return
        bytes += chunk.length
        if (bytes > 1024 * 1024) terminate('native_helper_failed')
        else chunks.push(chunk)
      })
      child.on('error', () => {
        failure ??= 'native_helper_failed'
      })
      child.stdin.on('error', () => terminate('native_helper_failed'))
      child.once('close', (code) => {
        clearTimeout(timeout)
        if (killTimer) clearTimeout(killTimer)
        options.signal?.removeEventListener('abort', abort)
        if (failure || code !== 0) {
          reject(new SystemSpeechError(failure ?? 'native_helper_failed'))
          return
        }
        try {
          const response = nativeResponseSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          if (!response.ok) throw new SystemSpeechError(response.error.code)
          if (response.value.operation !== request.operation) throw new SystemSpeechError('native_helper_failed')
          if (
            request.operation === 'synthesize' &&
            response.value.operation === 'synthesize' &&
            (response.value.result.outputPath !== request.outputPath ||
              response.value.result.voiceId !== request.voiceId)
          ) {
            throw new SystemSpeechError('native_helper_failed')
          }
          resolve(response.value as Extract<NativeSuccess, { operation: Request['operation'] }>)
        } catch (error) {
          reject(error instanceof SystemSpeechError ? error : new SystemSpeechError('native_helper_failed'))
        }
      })
      if (options.signal?.aborted) abort()
      else child.stdin.end(`${JSON.stringify(request)}\n`)
    })
  }
}
