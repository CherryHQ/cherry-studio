import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { application } from '@application'
import { generateText as aiCoreGenerateText } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import type { AppProviderSettingsMap } from '@main/ai/types'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { audioToTextDetailed } from '@main/features/fileProcessing/audioToText'
import {
  hashMediaExecutionConfig,
  resolveMediaExecutionConfig,
  type MediaExecutionConfig,
  type MediaVisionExecutionConfig
} from '@main/features/fileProcessing/media/mediaExecutionConfig'
import { mediaFfmpegProcess } from '@main/features/fileProcessing/media/mediaProcess'
import { planFrameTimestamps } from '@main/features/fileProcessing/media/probeClassification'
import { resolveFileProcessingFileInfo } from '@main/features/fileProcessing/tasks/jobExecution'
import type { FileHandle } from '@shared/data/types/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import {
  MEDIA_ANALYSIS_VERSION,
  type MediaAnalysis,
  type MediaAudioSegment,
  type MediaVisualFrame
} from '@shared/types/mediaAnalysis'
import { formatMediaAnalysisCompact, formatMediaAnalysisFull } from '@shared/utils/mediaAnalysis'

const logger = loggerService.withContext('MediaPreprocessingService')

const CACHE_TTL_MS = 30 * 60 * 1000
/** OpenAI transcription hard limit is 25,000,000 bytes (not MiB). */
const OPENAI_TRANSCRIPTION_MAX_BYTES = 25_000_000
const VISION_BATCH_SIZE = 6

export class MediaPreprocessingError extends Error {
  readonly i18nKey = 'media_unreadable_for_non_av_model'

  constructor(message: string) {
    super(message)
    this.name = 'MediaPreprocessingError'
  }
}

@Injectable('MediaPreprocessingService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['UtilityProcessManager', 'FileManager', 'FileProcessingService'])
export class MediaPreprocessingService extends BaseService {
  /**
   * Serialize FFmpeg utility jobs so a cancel can `stop()` the utility process
   * without aborting unrelated work.
   */
  private ffmpegGate: Promise<unknown> = Promise.resolve()

  protected onInit(): void {
    application.get('UtilityProcessManager').register(mediaFfmpegProcess)
    this.registerDisposable(() => {
      void application.get('UtilityProcessManager').client(mediaFfmpegProcess).stop()
    })
    logger.info('Media preprocessing service initialized')
  }

  private withFfmpegGate<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.ffmpegGate.then(fn, fn)
    this.ffmpegGate = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  /** Probe streams/MIME without running ASR/OCR/vision. */
  async probe(file: FileHandle, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const fileInfo = await resolveFileProcessingFileInfo(file)
    return this.withFfmpegGate(async () => {
      const client = application.get('UtilityProcessManager').client(mediaFfmpegProcess)
      try {
        return await client.request(
          'probe',
          { filePath: fileInfo.path, fallbackExt: fileInfo.ext ?? undefined },
          { signal }
        )
      } catch (error) {
        if (signal?.aborted) {
          await client.stop().catch((stopError) => {
            logger.warn('Failed to stop media utility after probe abort', { error: stopError })
          })
        }
        throw error
      }
    })
  }

  /**
   * Analyze audio/video into a structured {@link MediaAnalysis}. Native AV
   * callers should not invoke this — they send the original file.
   */
  async analyze(file: FileHandle, signal?: AbortSignal): Promise<MediaAnalysis> {
    signal?.throwIfAborted()
    const execution = await resolveMediaExecutionConfig()
    const cache = application.get('CacheService')
    const cacheKey = await this.buildCacheKey(file, execution)
    if (cacheKey) {
      const cached = cache.get<MediaAnalysis>(cacheKey)
      if (cached) return cached
    }

    return this.withFfmpegGate(async () => {
      const jobDir = join(application.getPath('app.temp'), 'av-preprocess', randomUUID())
      await mkdir(jobDir, { recursive: true })
      const active = new AbortController()
      const onAbort = () => active.abort(signal?.reason ?? new Error('Aborted'))
      if (signal?.aborted) active.abort(signal.reason ?? new Error('Aborted'))
      else signal?.addEventListener('abort', onAbort, { once: true })

      const client = application.get('UtilityProcessManager').client(mediaFfmpegProcess)
      try {
        const analysis = await this.runAnalysis(file, jobDir, active.signal, execution)
        if (cacheKey) cache.set(cacheKey, analysis, CACHE_TTL_MS)
        return analysis
      } catch (error) {
        if (active.signal.aborted || signal?.aborted) {
          await client.stop().catch((stopError) => {
            logger.warn('Failed to stop media utility after analysis abort', { error: stopError })
          })
        }
        throw error
      } finally {
        signal?.removeEventListener('abort', onAbort)
        await killJobChildPids(jobDir).catch(() => undefined)
        await rm(jobDir, { recursive: true, force: true }).catch((cleanupError) => {
          logger.warn('Failed to clean media preprocessing temp dir', { error: cleanupError })
        })
      }
    })
  }

  async analyzeToCompactText(file: FileHandle, signal?: AbortSignal): Promise<string> {
    return formatMediaAnalysisCompact(await this.analyze(file, signal))
  }

  async analyzeToFullText(file: FileHandle, signal?: AbortSignal): Promise<string> {
    return formatMediaAnalysisFull(await this.analyze(file, signal))
  }

  private async buildCacheKey(file: FileHandle, execution: MediaExecutionConfig): Promise<string | null> {
    if (file.kind !== 'entry') return null
    const version = await application.get('FileManager').getVersion(file.entryId)
    const configHash = hashMediaExecutionConfig(execution)
    return ['media-analysis', file.entryId, version.mtime, version.size, configHash].join(':')
  }

  private async runAnalysis(
    file: FileHandle,
    jobDir: string,
    signal: AbortSignal,
    execution: MediaExecutionConfig
  ): Promise<MediaAnalysis> {
    const fileInfo = await resolveFileProcessingFileInfo(file)
    const client = application.get('UtilityProcessManager').client(mediaFfmpegProcess)
    logger.debug('Analysis config snapshot', {
      asrId: execution.asr?.processor.id ?? 'none',
      ocrId: execution.ocr?.processor.id ?? 'none',
      visionId: execution.vision?.uniqueModelId ?? 'none',
      configHash: hashMediaExecutionConfig(execution)
    })

    const pidRegistryPath = join(jobDir, '.child-pids')
    const probe = await client.request(
      'probe',
      { filePath: fileInfo.path, fallbackExt: fileInfo.ext ?? undefined, pidRegistryPath },
      { signal }
    )

    const runAudioPath = async (): Promise<{
      audioOk: boolean
      segments: MediaAudioSegment[]
      warnings: string[]
    }> => {
      if (!probe.hasAudio) return { audioOk: false, segments: [], warnings: [] }
      const segments: MediaAudioSegment[] = []
      const warnings: string[] = []
      try {
        if (!execution.asr) throw new Error('No audio_to_text processor configured')
        const audioDir = join(jobDir, 'audio')
        await mkdir(audioDir, { recursive: true })
        const extracted = await client.request(
          'extractAudio',
          {
            filePath: fileInfo.path,
            outputDir: audioDir,
            maxChunkBytes: OPENAI_TRANSCRIPTION_MAX_BYTES,
            pidRegistryPath
          },
          { signal }
        )

        for (const chunk of extracted.chunks) {
          signal.throwIfAborted()
          try {
            const result = await audioToTextDetailed(
              { kind: 'path', path: AbsoluteFilePathSchema.parse(chunk.path) },
              { signal, config: execution.asr.processor }
            )
            const providerSegments = result.segments ?? []
            if (providerSegments.length > 0) {
              for (const segment of providerSegments) {
                const text = segment.text.trim()
                if (!text) continue
                segments.push({
                  startMs: chunk.startMs + segment.startMs,
                  endMs: chunk.startMs + segment.endMs,
                  text
                })
              }
              continue
            }
            const text = result.text.trim()
            if (!text) continue
            segments.push({ startMs: chunk.startMs, endMs: chunk.endMs, text })
          } catch (chunkError) {
            signal.throwIfAborted()
            throw chunkError
          }
        }
        if (segments.length === 0) warnings.push('No speech detected in the audio track.')
        return { audioOk: true, segments, warnings }
      } catch (error) {
        signal.throwIfAborted()
        logger.warn('Audio transcription path failed', {
          error: error instanceof Error ? error.message : String(error)
        })
        warnings.push('Audio transcription failed or is not configured.')
        return { audioOk: false, segments, warnings }
      }
    }

    const runVisualPath = async (): Promise<{
      visuals: MediaVisualFrame[]
      warnings: string[]
    }> => {
      if (!probe.hasVideo) return { visuals: [], warnings: [] }
      const warnings: string[] = []
      try {
        const frameDir = join(jobDir, 'frames')
        await mkdir(frameDir, { recursive: true })
        const budget = execution.budget
        const timestampsMs = planFrameTimestamps(probe.durationMs, budget.maxFrames, budget.targetIntervalMs)
        const extracted = await client.request(
          'extractFrames',
          {
            filePath: fileInfo.path,
            outputDir: frameDir,
            timestampsMs,
            maxEdgePx: budget.maxEdgePx,
            jpegQuality: budget.jpegQuality,
            pidRegistryPath
          },
          { signal }
        )

        const frameMap = new Map<number, MediaVisualFrame>()

        await Promise.all(
          extracted.frames.map(async (frame) => {
            if (!execution.ocr) return
            try {
              const ocrText = (
                await application
                  .get('FileProcessingService')
                  .ocrImage(
                    { kind: 'path', path: AbsoluteFilePathSchema.parse(frame.path) },
                    signal,
                    undefined,
                    execution.ocr.processor
                  )
              ).trim()
              const entry = frameMap.get(frame.timestampMs) ?? { timestampMs: frame.timestampMs }
              if (ocrText) entry.ocrText = ocrText
              frameMap.set(frame.timestampMs, entry)
            } catch (error) {
              signal.throwIfAborted()
              logger.warn('Frame OCR failed', {
                timestampMs: frame.timestampMs,
                error: error instanceof Error ? error.message : String(error)
              })
            }
          })
        )

        if (execution.vision) {
          try {
            const summaries = await summarizeFramesWithVision(execution.vision, extracted.frames, signal)
            for (const [timestampMs, summary] of summaries) {
              const entry = frameMap.get(timestampMs) ?? { timestampMs }
              entry.summary = summary
              frameMap.set(timestampMs, entry)
            }
          } catch (error) {
            signal.throwIfAborted()
            logger.warn('Vision summarization failed', {
              error: error instanceof Error ? error.message : String(error)
            })
            warnings.push('Video vision model failed or is unavailable.')
          }
        } else if (execution.ocr) {
          // OCR-only is fine; note missing vision.
          warnings.push('No video vision model configured in Default Models.')
        } else {
          warnings.push('No video vision model configured in Default Models.')
        }

        const visuals = [...frameMap.values()].sort((a, b) => a.timestampMs - b.timestampMs)
        if (!visuals.some((v) => Boolean(v.summary?.trim() || v.ocrText?.trim()))) {
          warnings.push('No visual summaries or on-screen text could be extracted.')
        }
        return { visuals, warnings }
      } catch (error) {
        signal.throwIfAborted()
        logger.warn('Visual preprocessing path failed', {
          error: error instanceof Error ? error.message : String(error)
        })
        warnings.push('Visual preprocessing failed.')
        return { visuals: [], warnings }
      }
    }

    // Independent ASR and visual paths may overlap for A+V sources; shared abort
    // still cancels both, and FFmpeg jobs remain serialized across analyze() calls.
    const audioTask = runAudioPath()
    const visualTask = runVisualPath()
    const [audioResult, visualResult] = await Promise.all([audioTask, visualTask])

    const { audioOk, segments: audioSegments } = audioResult
    const { visuals } = visualResult
    const warnings = [...audioResult.warnings, ...visualResult.warnings]

    const analysis: MediaAnalysis = {
      version: MEDIA_ANALYSIS_VERSION,
      source: {
        mime: probe.mime,
        durationMs: probe.durationMs,
        hasAudio: probe.hasAudio,
        hasVideo: probe.hasVideo
      },
      ...(audioOk ? { audio: { segments: audioSegments } } : {}),
      ...(visuals.length > 0 ? { visuals } : {}),
      warnings
    }

    const hasSpeech = audioSegments.some((s) => s.text.trim())
    const hasVisualContent = visuals.some((v) => Boolean(v.summary?.trim() || v.ocrText?.trim()))
    // Speech only counts when the full ASR path succeeded (audioOk). A later
    // chunk failure sets audioOk=false and must abort unless visuals succeeded.
    const silentAudioOk = audioOk && probe.hasAudio && !hasSpeech
    const hasUsable = (audioOk && hasSpeech) || hasVisualContent || silentAudioOk

    if (!hasUsable) {
      throw new MediaPreprocessingError(
        "The selected model isn't configured for audio or video input, and Cherry Studio couldn't analyze the attachment. Configure an audio transcription processor and/or video vision model in Settings, pick a model that accepts this media natively, or remove the file and try again."
      )
    }

    return analysis
  }
}

async function summarizeFramesWithVision(
  vision: MediaVisionExecutionConfig,
  frames: { path: string; timestampMs: number }[],
  signal: AbortSignal
): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const { sdkConfig } = vision

  let batchFailures = 0
  for (let i = 0; i < frames.length; i += VISION_BATCH_SIZE) {
    signal.throwIfAborted()
    const batch = frames.slice(i, i + VISION_BATCH_SIZE)
    const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: Buffer; mediaType: 'image/jpeg' }> = [
      {
        type: 'text',
        text: 'Describe each attached video frame briefly: scenes, people, and actions. Reply with one line per frame as `FRAME_<id>: summary`. Do not transcribe speech.'
      }
    ]

    for (const frame of batch) {
      const data = await readFile(frame.path)
      content.push({ type: 'text', text: `FRAME_t${frame.timestampMs}` })
      content.push({ type: 'image', image: data, mediaType: 'image/jpeg' })
    }

    try {
      const result = await aiCoreGenerateText<AppProviderSettingsMap>(
        sdkConfig.providerId,
        sdkConfig.providerSettings,
        {
          model: sdkConfig.modelId,
          abortSignal: signal,
          messages: [{ role: 'user', content }]
        }
      )
      assignVisionSummaries(batch, result.text ?? '', out)
    } catch (error) {
      signal.throwIfAborted()
      batchFailures += 1
      logger.warn('Vision batch failed; keeping prior summaries', {
        batchStart: i,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  if (out.size === 0 && batchFailures > 0) {
    throw new Error('All vision batches failed')
  }
  return out
}

function assignVisionSummaries(batch: { timestampMs: number }[], text: string, out: Map<number, string>): void {
  const wanted = new Set(batch.map((frame) => frame.timestampMs))
  for (const line of text.split('\n')) {
    const match = /^\s*FRAME_t(\d+)\s*:\s*(.+)\s*$/i.exec(line)
    if (!match) continue
    const timestampMs = Number(match[1])
    const summary = match[2]?.trim()
    if (!wanted.has(timestampMs) || !summary) continue
    out.set(timestampMs, summary)
  }
}

/** Kill FFmpeg PIDs recorded by the utility worker for this job directory. */
async function killJobChildPids(jobDir: string): Promise<void> {
  const { readFile } = await import('node:fs/promises')
  const { spawn } = await import('node:child_process')
  try {
    const raw = await readFile(join(jobDir, '.child-pids'), 'utf8')
    const pids = raw
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 1)
    for (const pid of pids) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        } else {
          process.kill(pid, 'SIGKILL')
        }
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* no registry */
  }
}
