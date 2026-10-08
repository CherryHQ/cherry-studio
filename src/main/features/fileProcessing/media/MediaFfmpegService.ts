import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Conditional, DependsOn, Injectable, onPlatform, Phase, ServicePhase } from '@main/core/lifecycle'
import type { UtilityProcessRequestOptions } from '@main/core/utilityProcess/types'

import {
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

export type MediaProbeRequest = Omit<MediaProbeInput, 'pidRegistryPath'>
export type MediaExtractAudioRequest = Omit<MediaExtractAudioInput, 'pidRegistryPath'>
export type MediaExtractFramesRequest = Omit<MediaExtractFramesInput, 'pidRegistryPath'>

@Injectable('MediaFfmpegService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['UtilityProcessManager'])
@Conditional(onPlatform('darwin', 'win32'))
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

  private run<M extends keyof MediaFfmpegContract['methods'] & string>(
    method: M,
    input: Omit<MediaFfmpegContract['methods'][M]['input'], 'pidRegistryPath'>,
    options: UtilityProcessRequestOptions<MediaFfmpegContract['methods'][M]['event']>
  ): Promise<MediaFfmpegContract['methods'][M]['output']> {
    const generation = this.generation
    const run = this.gate.then(
      () => this.request(method, input, options, generation),
      () => this.request(method, input, options, generation)
    )
    this.gate = run.then(
      () => undefined,
      () => undefined
    )
    return run
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
