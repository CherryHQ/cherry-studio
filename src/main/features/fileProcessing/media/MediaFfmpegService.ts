import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Conditional, DependsOn, Injectable, onPlatform, Phase, ServicePhase } from '@main/core/lifecycle'
import type { UtilityProcessRequestOptions } from '@main/core/utilityProcess/types'

import {
  type MediaDetectSceneChangesInput,
  type MediaDetectSceneChangesResult,
  type MediaExtractAudioInput,
  type MediaExtractAudioResult,
  type MediaExtractFramesInput,
  type MediaExtractFramesResult,
  type MediaFfmpegContract,
  mediaFfmpegProcess,
  type MediaProbeInput
} from './mediaFfmpegProcess'
import type { ClassifiedMediaProbe } from './probeClassification'

const logger = loggerService.withContext('MediaFfmpegService')

function observedRejection(reason: unknown): Promise<never> {
  const rejected = Promise.reject(reason)
  void rejected.catch(() => undefined)
  return rejected
}

export type MediaProbeRequest = Omit<MediaProbeInput, 'pidRegistryPath'>
export type MediaExtractAudioRequest = Omit<MediaExtractAudioInput, 'pidRegistryPath'>
export type MediaExtractFramesRequest = Omit<MediaExtractFramesInput, 'pidRegistryPath'>
export type MediaDetectSceneChangesRequest = Omit<MediaDetectSceneChangesInput, 'pidRegistryPath'>

@Injectable('MediaFfmpegService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['UtilityProcessManager'])
@Conditional(onPlatform('darwin', 'win32', 'linux'))
export class MediaFfmpegService extends BaseService {
  private gate: Promise<unknown> = Promise.resolve()
  private initialized = false
  private generation = 0

  protected onInit(): void {
    const manager = application.get('UtilityProcessManager')
    manager.register(mediaFfmpegProcess)
    this.generation += 1
    this.initialized = true
  }

  protected async onStop(): Promise<void> {
    this.initialized = false
    await application.get('UtilityProcessManager').client(mediaFfmpegProcess).stop()
  }

  probe(input: MediaProbeRequest, signal?: AbortSignal): Promise<ClassifiedMediaProbe> {
    return this.run('probe', input, { signal })
  }

  extractAudio(input: MediaExtractAudioRequest, signal?: AbortSignal): Promise<MediaExtractAudioResult> {
    return this.run('extractAudio', input, { signal })
  }

  extractFrames(input: MediaExtractFramesRequest, signal?: AbortSignal): Promise<MediaExtractFramesResult> {
    return this.run('extractFrames', input, { signal })
  }

  detectSceneChanges(
    input: MediaDetectSceneChangesRequest,
    signal?: AbortSignal
  ): Promise<MediaDetectSceneChangesResult> {
    return this.run('detectSceneChanges', input, { signal })
  }

  private run<M extends keyof MediaFfmpegContract['methods'] & string>(
    method: M,
    input: Omit<MediaFfmpegContract['methods'][M]['input'], 'pidRegistryPath'>,
    options: UtilityProcessRequestOptions<MediaFfmpegContract['methods'][M]['event']>
  ): Promise<MediaFfmpegContract['methods'][M]['output']> {
    const signal = options.signal
    if (signal?.aborted) return observedRejection(signal.reason)

    const generation = this.generation
    let waiting = true
    let rejectWaiting: (reason?: unknown) => void = () => undefined
    const onQueuedAbort = () => {
      if (waiting && signal) rejectWaiting(signal.reason)
    }
    const caller = new Promise<MediaFfmpegContract['methods'][M]['output']>((resolve, reject) => {
      rejectWaiting = reject
      const start = () => {
        waiting = false
        signal?.removeEventListener('abort', onQueuedAbort)
        if (signal?.aborted) {
          reject(signal.reason)
          return
        }
        return this.request(method, input, options, generation).then(resolve, reject)
      }
      const queued = this.gate.then(start, start)
      this.gate = queued.then(
        () => undefined,
        () => undefined
      )
    })
    // `queued` already has a rejection handler. `caller` can reject while a
    // consumer is still attaching its own, so observe it without swallowing it.
    void caller.finally(() => signal?.removeEventListener('abort', onQueuedAbort)).catch(() => undefined)
    signal?.addEventListener('abort', onQueuedAbort, { once: true })
    return caller
  }

  private async request<M extends keyof MediaFfmpegContract['methods'] & string>(
    method: M,
    input: Omit<MediaFfmpegContract['methods'][M]['input'], 'pidRegistryPath'>,
    options: UtilityProcessRequestOptions<MediaFfmpegContract['methods'][M]['event']>,
    generation: number
  ): Promise<MediaFfmpegContract['methods'][M]['output']> {
    if (!this.initialized || generation !== this.generation) {
      throw new Error('MediaFfmpegService request belongs to an inactive lifecycle generation')
    }
    options.signal?.throwIfAborted()
    const registryDir = await mkdtemp(application.getPath('app.temp', 'media-ffmpeg-'))
    const pidRegistryPath = join(registryDir, 'active-child.pid')
    try {
      if (!this.initialized || generation !== this.generation) {
        throw new Error('MediaFfmpegService request belongs to an inactive lifecycle generation')
      }
      const client = application.get('UtilityProcessManager').client(mediaFfmpegProcess)
      return await client.request(method, { ...input, pidRegistryPath }, options)
    } catch (error) {
      if (!(await killRegisteredProcess(pidRegistryPath))) {
        logger.warn('Timed out waiting for an orphaned media process to exit')
      }
      throw error
    } finally {
      await rm(registryDir, { recursive: true, force: true }).catch((error) => {
        logger.warn('Failed to remove media process registry directory', { error })
      })
    }
  }
}

const PROCESS_EXIT_TIMEOUT_MS = 5_000
const PROCESS_EXIT_POLL_MS = 20

async function killRegisteredProcess(pidRegistryPath: string): Promise<boolean> {
  let pid: number
  try {
    pid = Number((await readFile(pidRegistryPath, 'utf8')).trim())
  } catch {
    return true
  }
  if (!Number.isInteger(pid) || pid <= 1) return true

  try {
    if (process.platform !== 'win32') {
      process.kill(pid, 'SIGKILL')
    } else {
      await new Promise<void>((resolve) => {
        const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        killer.once('error', () => resolve())
        killer.once('close', () => resolve())
      })
    }
  } catch {
    // The process already exited between reading the registry and sending the signal.
  }

  const deadline = Date.now() + PROCESS_EXIT_TIMEOUT_MS
  while (isProcessRunning(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, PROCESS_EXIT_POLL_MS))
  }
  return !isProcessRunning(pid)
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
