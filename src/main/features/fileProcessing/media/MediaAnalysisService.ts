import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { application } from '@application'
import { generateText as aiCoreGenerateText, type TranscriptionResult } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { createAiUsagePlugin } from '@main/ai/hooks/billingHook'
import type { MediaAnalysisGaps } from '@main/ai/messages/mediaAnalysisRequestError'
import type { AppProviderSettingsMap } from '@main/ai/types'
import { startTranscription } from '@main/ai/voice/execution'
import { VoiceRuntimeError } from '@main/ai/voice/VoiceRuntimeError'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { resolveFileProcessingFileInfo } from '@main/features/fileProcessing/tasks/jobExecution'
import type { MediaAnalysisProgress } from '@shared/ai/mediaAnalysisProgress'
import { TranscriptionInputKind, TranscriptionOutputKind } from '@shared/ai/voice'
import type { FileHandle } from '@shared/data/types/file'
import type { FileInfo } from '@shared/types/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import {
  FRAME_SIMILARITY_MAD_THRESHOLD,
  planAnalysisFrameTimestamps,
  SCENE_SAMPLE_FPS,
  SCENE_SCAN_EDGE_PX,
  SCENE_SCORE_THRESHOLD,
  sceneCandidateLimit,
  selectDistinctFrameIndexes
} from './frameSelection'
import { readFrameSignature } from './frameSignature'
import { formatMediaAnalysisCompact, formatMediaAnalysisFull, isMediaAnalysis } from './mediaAnalysisFormat'
import {
  hashMediaExecutionConfig,
  resolveMediaExecutionConfig,
  type MediaAnalysisOptions,
  type MediaExecutionConfig,
  type MediaVisionExecutionConfig
} from './mediaExecutionConfig'
import type { MediaFfmpegService } from './MediaFfmpegService'
import type { ClassifiedMediaProbe } from './probeClassification'
import {
  MEDIA_ANALYSIS_VERSION,
  type MediaAnalysis,
  type MediaAnalysisWarningCode,
  type MediaAudioSegment,
  type MediaVisualFrame
} from './types'

const logger = loggerService.withContext('MediaAnalysisService')
const CACHE_TTL_MS = 30 * 60 * 1000
const MAX_AUDIO_CHUNK_BYTES = 25_000_000
const VISION_BATCH_SIZE = 6
const RECOVERABLE_ANALYSIS_WARNINGS = new Set<MediaAnalysisWarningCode>([
  'audio_transcription_failed',
  'ocr_failed',
  'vision_failed',
  'visual_analysis_failed'
])

export class MediaAnalysisError extends Error {
  constructor(
    readonly code: 'unusable_media_analysis',
    readonly gaps?: MediaAnalysisGaps
  ) {
    super(code)
    this.name = 'MediaAnalysisError'
  }
}

@Injectable('MediaAnalysisService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['FileManager', 'FileProcessingService', 'MediaFfmpegService'])
export class MediaAnalysisService extends BaseService {
  async probe(file: FileHandle, signal?: AbortSignal): Promise<ClassifiedMediaProbe> {
    signal?.throwIfAborted()
    const fileInfo = await resolveFileProcessingFileInfo(file)
    return this.mediaFfmpeg().probe({ filePath: fileInfo.path, fallbackExt: fileInfo.ext ?? undefined }, signal)
  }

  /** In-flight `prepare` passes by file, so a send waits for one instead of repeating its local work. */
  private readonly localPasses = new Map<string, LocalPass>()

  async analyze(file: FileHandle, signal?: AbortSignal, options: MediaAnalysisOptions = {}): Promise<MediaAnalysis> {
    signal?.throwIfAborted()
    const fileInfo = await resolveFileProcessingFileInfo(file)
    const contentKey = await contentKeyOf(file, fileInfo)
    const pending = this.localPasses.get(contentKey)
    if (pending) {
      // The waiting send shows the running pass's progress instead of a silent wait.
      const { onProgress } = options
      if (onProgress) {
        if (pending.last) onProgress(pending.last)
        pending.listeners.add(onProgress)
      }
      try {
        await settledUnlessAborted(pending.done, signal)
      } finally {
        if (onProgress) pending.listeners.delete(onProgress)
      }
    }
    return this.analyzeFile(file, fileInfo, contentKey, signal, options, false)
  }

  /**
   * Runs the free local stages (transcription, frame selection, OCR) ahead of a send, so the send
   * only adds the paid vision calls. Failures are left for the send to report.
   */
  async prepare(file: FileHandle, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const fileInfo = await resolveFileProcessingFileInfo(file)
    const contentKey = await contentKeyOf(file, fileInfo)
    const running = this.localPasses.get(contentKey)
    if (running) return running.done
    const listeners = new Set<(progress: MediaAnalysisProgress) => void>()
    const onProgress = (progress: MediaAnalysisProgress) => {
      pass.last = progress
      for (const listener of listeners) listener(progress)
    }
    const pass: LocalPass = {
      listeners,
      done: this.analyzeFile(file, fileInfo, contentKey, signal, { onProgress }, true).then(
        () => undefined,
        (error: unknown) => {
          if (signal?.aborted) return
          logger.debug('Media pre-analysis ended without a usable result', { error })
        }
      )
    }
    this.localPasses.set(contentKey, pass)
    try {
      await pass.done
    } finally {
      this.localPasses.delete(contentKey)
    }
  }

  private async analyzeFile(
    file: FileHandle,
    fileInfo: FileInfo,
    contentKey: string,
    signal: AbortSignal | undefined,
    options: MediaAnalysisOptions,
    localOnly: boolean
  ): Promise<MediaAnalysis> {
    const resolved = await resolveMediaExecutionConfig(options)
    // A pre-analysis never pays for vision; the send adds it over the cached local stages.
    const execution = localOnly ? { ...resolved, vision: null } : resolved
    const fileKey = fileKeyOf(file, fileInfo)
    const cacheKey = ['media-analysis', fileKey, hashMediaExecutionConfig(execution)].join(':')
    // Re-check after the awaits above so a cache hit cannot mask a cancellation.
    signal?.throwIfAborted()
    const cache = application.get('CacheService')
    const cached = cache.get<unknown>(cacheKey)
    if (isMediaAnalysis(cached)) return cached

    // Stages key by content: a pre-analysis runs on the picked file, the send on its stored copy.
    const stageKey = (stage: string, identity: unknown) =>
      `media-analysis:${stage}:${contentKey}:${hashIdentity({ identity, pipelineVersion: execution.pipelineVersion })}`
    const startedAt = Date.now()
    const jobDir = application.getPath('app.temp', `media-analysis-${randomUUID()}`)
    await mkdir(jobDir, { recursive: true })
    try {
      const analysis = await this.runAnalysis(
        fileInfo.path,
        fileInfo.ext,
        jobDir,
        execution,
        {
          vision: `${cacheKey}:vision`,
          transcript: stageKey('asr', execution.asr),
          framePlan: stageKey('frames', execution.budget),
          frameText: stageKey('ocr', { ocr: execution.ocr?.identity ?? null, budget: execution.budget })
        },
        signal,
        options.onProgress
      )
      logger.info('Media analysis finished', {
        localOnly,
        durationMs: Date.now() - startedAt,
        frames: analysis.visuals?.length ?? 0,
        warnings: analysis.warnings
      })
      // Without an ASR model the transcription warning is a settings state the cache key already carries.
      const retryable = analysis.warnings.some(
        (warning) =>
          RECOVERABLE_ANALYSIS_WARNINGS.has(warning) && (warning !== 'audio_transcription_failed' || execution.asr)
      )
      if (!retryable) cache.set(cacheKey, analysis, CACHE_TTL_MS)
      return analysis
    } finally {
      await rm(jobDir, { recursive: true, force: true }).catch(() => {
        logger.warn('Failed to remove media analysis job directory')
      })
    }
  }

  async analyzeToCompactText(file: FileHandle, signal?: AbortSignal, options?: MediaAnalysisOptions): Promise<string> {
    return formatMediaAnalysisCompact(await this.analyze(file, signal, options))
  }

  async analyzeToFullText(file: FileHandle, signal?: AbortSignal, options?: MediaAnalysisOptions): Promise<string> {
    return formatMediaAnalysisFull(await this.analyze(file, signal, options))
  }

  private async runAnalysis(
    filePath: string,
    fallbackExt: string | null,
    jobDir: string,
    execution: MediaExecutionConfig,
    keys: StageCacheKeys,
    signal?: AbortSignal,
    onProgress?: (progress: MediaAnalysisProgress) => void
  ): Promise<MediaAnalysis> {
    signal?.throwIfAborted()
    const ffmpeg = this.mediaFfmpeg()
    const probe = await ffmpeg.probe({ filePath, fallbackExt: fallbackExt ?? undefined }, signal)
    const [audio, visual] = await Promise.all([
      this.analyzeAudio(filePath, probe, jobDir, execution, keys.transcript, signal, onProgress),
      this.analyzeVisuals(filePath, probe, jobDir, execution, keys, signal, onProgress)
    ])
    signal?.throwIfAborted()

    const warnings = [...new Set([...audio.warnings, ...visual.warnings])]
    const analysis: MediaAnalysis = {
      version: MEDIA_ANALYSIS_VERSION,
      source: {
        mime: probe.mime,
        durationMs: probe.durationMs,
        hasAudio: probe.hasAudio,
        hasVideo: probe.hasVideo
      },
      ...(audio.completed || audio.segments.length > 0 ? { audio: { segments: audio.segments } } : {}),
      ...(visual.frames.length > 0 ? { visuals: visual.frames } : {}),
      warnings
    }

    const hasSpeech = audio.segments.some((segment) => segment.text.trim())
    const hasVisualContent = visual.frames.some((frame) => frame.summary?.trim() || frame.ocrText?.trim())
    const successfulSilence = audio.completed && probe.hasAudio && !hasSpeech
    if (!hasSpeech && !hasVisualContent && !successfulSilence) {
      throw new MediaAnalysisError('unusable_media_analysis', {
        vision: probe.hasVideo && !execution.vision,
        speech: probe.hasAudio && !audio.completed
      })
    }
    return analysis
  }

  private async analyzeAudio(
    filePath: string,
    probe: ClassifiedMediaProbe,
    jobDir: string,
    execution: MediaExecutionConfig,
    transcriptKey: string,
    signal?: AbortSignal,
    onProgress?: (progress: MediaAnalysisProgress) => void
  ): Promise<{ completed: boolean; segments: MediaAudioSegment[]; warnings: MediaAnalysisWarningCode[] }> {
    if (!probe.hasAudio) return { completed: false, segments: [], warnings: [] }
    if (!execution.asr) return { completed: false, segments: [], warnings: ['audio_transcription_failed'] }

    const cache = application.get('CacheService')
    const transcript = readTranscript(cache.get<unknown>(transcriptKey))
    if (transcript) return { completed: true, ...transcript }

    onProgress?.({ stage: 'transcribing' })
    const segments: MediaAudioSegment[] = []
    try {
      const outputDir = join(jobDir, 'audio')
      await mkdir(outputDir, { recursive: true })
      const extracted = await this.mediaFfmpeg().extractAudio(
        { filePath, outputDir, maxChunkBytes: MAX_AUDIO_CHUNK_BYTES },
        signal
      )
      let noSpeech = false

      for (const chunk of extracted.chunks) {
        signal?.throwIfAborted()
        const bytes = new Uint8Array(await readFile(chunk.path))
        const transcription = startTranscription(
          {
            modelId: execution.asr.modelId,
            input: { kind: TranscriptionInputKind.Audio, audio: bytes },
            output: TranscriptionOutputKind.Final,
            options: { ...(execution.asr.language && { language: execution.asr.language }) }
          },
          signal
        )
        let result: TranscriptionResult | undefined
        try {
          result = await transcription.completed
        } catch (error) {
          signal?.throwIfAborted()
          if (error instanceof VoiceRuntimeError && error.reason === 'no_speech') noSpeech = true
          else throw error
        } finally {
          await transcription.closed
        }
        if (!result) continue
        let accepted = 0
        if (result.segments.length > 0) {
          for (const segment of result.segments) {
            const text = segment.text.trim()
            if (!text) continue
            accepted += 1
            segments.push({
              startMs: sourceAudioMs(probe.audioStartMs, chunk.startMs, segment.startSecond),
              endMs: sourceAudioMs(probe.audioStartMs, chunk.startMs, segment.endSecond),
              text
            })
          }
        } else if (result.text.trim()) {
          accepted += 1
          segments.push({
            startMs: sourceAudioMs(probe.audioStartMs, chunk.startMs),
            endMs: sourceAudioMs(probe.audioStartMs, chunk.endMs),
            text: result.text.trim()
          })
        }
        if (accepted === 0) noSpeech = true
      }

      const warnings: MediaAnalysisWarningCode[] = noSpeech || segments.length === 0 ? ['no_speech'] : []
      cache.set(transcriptKey, { segments, warnings }, CACHE_TTL_MS)
      return { completed: true, segments, warnings }
    } catch (error) {
      signal?.throwIfAborted()
      logger.warn('Audio analysis failed', { error: errorMessage(error) })
      return { completed: false, segments, warnings: ['audio_transcription_failed'] }
    }
  }

  private async analyzeVisuals(
    filePath: string,
    probe: ClassifiedMediaProbe,
    jobDir: string,
    execution: MediaExecutionConfig,
    keys: StageCacheKeys,
    signal?: AbortSignal,
    onProgress?: (progress: MediaAnalysisProgress) => void
  ): Promise<{ frames: MediaVisualFrame[]; warnings: MediaAnalysisWarningCode[] }> {
    if (!probe.hasVideo) return { frames: [], warnings: [] }

    try {
      const outputDir = join(jobDir, 'frames')
      await mkdir(outputDir, { recursive: true })
      const cache = application.get('CacheService')
      const plannedMs = cache.get<unknown>(keys.framePlan)
      let timestampsMs: number[]
      if (Array.isArray(plannedMs) && plannedMs.every((value) => typeof value === 'number')) {
        timestampsMs = plannedMs
      } else {
        timestampsMs = await this.planFrames(filePath, probe, execution, signal)
        cache.set(keys.framePlan, timestampsMs, CACHE_TTL_MS)
      }
      const extracted = await this.mediaFfmpeg().extractFrames(
        {
          filePath,
          outputDir,
          timestampsMs,
          maxEdgePx: execution.budget.maxEdgePx,
          jpegQuality: execution.budget.jpegQuality
        },
        signal
      )
      const signatures = await Promise.all(extracted.frames.map((frame) => readFrameSignature(frame.path)))
      signal?.throwIfAborted()
      const distinctFrames = selectDistinctFrameIndexes(signatures, FRAME_SIMILARITY_MAD_THRESHOLD).flatMap((index) => {
        const frame = extracted.frames[index]
        return frame ? [frame] : []
      })
      const frames = new Map<number, MediaVisualFrame>(
        distinctFrames.map((frame) => [frame.timestampMs, { timestampMs: frame.timestampMs }])
      )
      const warnings = new Set<MediaAnalysisWarningCode>()

      if (execution.ocr) {
        const ocr = execution.ocr
        // Read text is kept per frame, so a later run never loses it to a flaky system OCR call.
        const read = readFrameText(cache.get<unknown>(keys.frameText))
        const unread = distinctFrames.filter((frame) => !read.has(frame.timestampMs))
        let done = distinctFrames.length - unread.length
        if (unread.length) onProgress?.({ stage: 'reading_frames', done, total: distinctFrames.length })
        await Promise.all(
          unread.map(async (frame) => {
            const text = await ocrFrameWithRetry(frame, ocr, signal)
            if (text !== null) read.set(frame.timestampMs, text)
            onProgress?.({ stage: 'reading_frames', done: ++done, total: distinctFrames.length })
          })
        )
        cache.set(keys.frameText, Object.fromEntries(read), CACHE_TTL_MS)
        for (const frame of distinctFrames) {
          const text = read.get(frame.timestampMs)
          if (text) frames.set(frame.timestampMs, { ...frames.get(frame.timestampMs)!, ocrText: text })
          if (text === undefined) warnings.add('ocr_failed')
        }
      }

      if (execution.vision) {
        // Answered frames are already paid for; a retry caused by another modality must not resend them.
        const answered = readAnsweredFrames(keys.vision)
        try {
          const unanswered = distinctFrames.filter((frame) => !answered.has(frame.timestampMs))
          await summarizeFrames(execution.vision, unanswered, answered, signal, (done) =>
            onProgress?.({
              stage: 'describing_frames',
              done: distinctFrames.length - unanswered.length + done,
              total: distinctFrames.length
            })
          )
        } finally {
          cache.set(keys.vision, Object.fromEntries(answered), CACHE_TTL_MS)
        }
        for (const frame of distinctFrames) {
          const summary = answered.get(frame.timestampMs)
          if (summary) frames.set(frame.timestampMs, { ...frames.get(frame.timestampMs)!, summary })
        }
        if (distinctFrames.some((frame) => !answered.has(frame.timestampMs))) warnings.add('vision_failed')
      } else {
        warnings.add('vision_model_unavailable')
      }

      const ordered = [...frames.values()].sort((left, right) => left.timestampMs - right.timestampMs)
      if (!ordered.some((frame) => frame.summary?.trim() || frame.ocrText?.trim())) warnings.add('no_visual_content')
      return { frames: ordered, warnings: [...warnings] }
    } catch (error) {
      signal?.throwIfAborted()
      logger.warn('Visual analysis failed', { error: errorMessage(error) })
      return { frames: [], warnings: ['visual_analysis_failed'] }
    }
  }

  private async planFrames(
    filePath: string,
    probe: ClassifiedMediaProbe,
    execution: MediaExecutionConfig,
    signal?: AbortSignal
  ): Promise<number[]> {
    let sceneChanges: Array<{ timestampMs: number; score: number }> = []
    if (probe.durationMs > 0) {
      try {
        const detected = await this.mediaFfmpeg().detectSceneChanges(
          {
            filePath,
            durationMs: probe.durationMs,
            sampleFps: SCENE_SAMPLE_FPS,
            scoreThreshold: SCENE_SCORE_THRESHOLD,
            scanEdgePx: SCENE_SCAN_EDGE_PX,
            maxCandidates: sceneCandidateLimit(execution.budget.maxFrames)
          },
          signal
        )
        sceneChanges = detected.changes
      } catch {
        signal?.throwIfAborted()
        logger.warn('Scene detection failed; continuing with uniform frames')
      }
    }
    return planAnalysisFrameTimestamps({
      durationMs: probe.durationMs,
      maxFrames: execution.budget.maxFrames,
      targetIntervalMs: execution.budget.targetIntervalMs,
      sceneChanges
    })
  }

  // Declared @DependsOn: this service is excluded when MediaFfmpegService is.
  private mediaFfmpeg(): MediaFfmpegService {
    return application.getOptional('MediaFfmpegService') as MediaFfmpegService
  }
}

function readAnsweredFrames(key: string): Map<number, string | null> {
  const cached = application.get('CacheService').get<unknown>(key)
  if (!cached || typeof cached !== 'object') return new Map()
  return new Map(
    Object.entries(cached).flatMap(
      ([timestampMs, summary]): Array<[number, string | null]> =>
        typeof summary === 'string' || summary === null ? [[Number(timestampMs), summary]] : []
    )
  )
}

/** Records every frame of a successful batch in `answered`; a failed batch leaves its frames for a retry. */
async function summarizeFrames(
  vision: MediaVisionExecutionConfig,
  frames: Array<{ path: string; timestampMs: number }>,
  answered: Map<number, string | null>,
  signal?: AbortSignal,
  onBatchStart?: (done: number) => void
): Promise<void> {
  for (let index = 0; index < frames.length; index += VISION_BATCH_SIZE) {
    signal?.throwIfAborted()
    onBatchStart?.(index)
    const batch = frames.slice(index, index + VISION_BATCH_SIZE)
    try {
      const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: Buffer; mediaType: 'image/jpeg' }> =
        [
          {
            type: 'text',
            text: 'Describe each video frame briefly. Reply with one line per frame as FRAME_<timestamp>: summary. Do not transcribe speech.'
          }
        ]
      for (const frame of batch) {
        content.push({ type: 'text', text: `FRAME_${frame.timestampMs}` })
        content.push({ type: 'image', image: await readFile(frame.path), mediaType: 'image/jpeg' })
      }
      const result = await aiCoreGenerateText<AppProviderSettingsMap>(
        vision.sdkConfig.providerId,
        vision.sdkConfig.providerSettings,
        {
          model: vision.sdkConfig.modelId,
          abortSignal: signal,
          messages: [{ role: 'user', content }]
        },
        [createAiUsagePlugin(vision.usage)]
      )
      assignSummaries(batch, result.text, answered)
    } catch {
      signal?.throwIfAborted()
    }
  }
}

function sourceAudioMs(audioStartMs: number | undefined, chunkMs: number, segmentSeconds = 0): number {
  return Math.max(0, audioStartMs ?? 0) + chunkMs + Math.round(segmentSeconds * 1000)
}

function assignSummaries(
  batch: Array<{ timestampMs: number }>,
  text: string,
  answered: Map<number, string | null>
): void {
  const parsed = new Map<number, string>()
  for (const line of text.split('\n')) {
    const match = /^\s*FRAME_(\d+)\s*:\s*(.+)\s*$/i.exec(line)
    const summary = match?.[2]?.trim()
    if (match && summary) parsed.set(Number(match[1]), summary)
  }
  // A paid reply that skips a frame still answers it; asking again would bill the same frame.
  for (const frame of batch) answered.set(frame.timestampMs, parsed.get(frame.timestampMs) ?? null)
}

interface LocalPass {
  done: Promise<void>
  listeners: Set<(progress: MediaAnalysisProgress) => void>
  last?: MediaAnalysisProgress
}

interface StageCacheKeys {
  vision: string
  transcript: string
  framePlan: string
  frameText: string
}

function fileKeyOf(file: FileHandle, fileInfo: FileInfo): string {
  const identity =
    file.kind === 'entry'
      ? `entry:${file.entryId}`
      : `path:${createHash('sha256').update(fileInfo.path).digest('hex').slice(0, 24)}`
  return `${identity}:${fileInfo.modifiedAt}:${fileInfo.size}`
}

const CONTENT_SAMPLE_BYTES = 1024 * 1024

/** Size plus the first and last MiB: cheap for long videos and equal for a file and its stored copy. */
async function contentKeyOf(file: FileHandle, fileInfo: FileInfo): Promise<string> {
  try {
    const handle = await open(fileInfo.path, 'r')
    try {
      const head = Buffer.alloc(Math.min(CONTENT_SAMPLE_BYTES, fileInfo.size))
      const tail = Buffer.alloc(Math.min(CONTENT_SAMPLE_BYTES, Math.max(0, fileInfo.size - head.length)))
      await handle.read(head, 0, head.length, 0)
      await handle.read(tail, 0, tail.length, fileInfo.size - tail.length)
      return `content:${createHash('sha256').update(String(fileInfo.size)).update(head).update(tail).digest('hex').slice(0, 32)}`
    } finally {
      await handle.close()
    }
  } catch {
    return fileKeyOf(file, fileInfo)
  }
}

function hashIdentity(identity: unknown): string {
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24)
}

async function settledUnlessAborted(pending: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return pending
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    void pending.finally(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    })
  })
}

function readTranscript(
  cached: unknown
): { segments: MediaAudioSegment[]; warnings: MediaAnalysisWarningCode[] } | undefined {
  if (!cached || typeof cached !== 'object') return undefined
  const { segments, warnings } = cached as { segments?: unknown; warnings?: unknown }
  return Array.isArray(segments) && Array.isArray(warnings)
    ? { segments: segments as MediaAudioSegment[], warnings: warnings as MediaAnalysisWarningCode[] }
    : undefined
}

function readFrameText(cached: unknown): Map<number, string> {
  if (!cached || typeof cached !== 'object') return new Map()
  return new Map(
    Object.entries(cached).flatMap(
      ([timestampMs, text]): Array<[number, string]> => (typeof text === 'string' ? [[Number(timestampMs), text]] : [])
    )
  )
}

/** One retry absorbs a transient system OCR error; `null` leaves the frame for the next run. */
async function ocrFrameWithRetry(
  frame: { path: string; timestampMs: number },
  ocr: NonNullable<MediaExecutionConfig['ocr']>,
  signal?: AbortSignal
): Promise<string | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const text = await application
        .get('FileProcessingService')
        .ocrImage({ kind: 'path', path: AbsoluteFilePathSchema.parse(frame.path) }, signal, ocr.processor)
      return text.trim()
    } catch (error) {
      signal?.throwIfAborted()
      logger.warn('Frame OCR failed', { timestampMs: frame.timestampMs, attempt, error: errorMessage(error) })
    }
  }
  return null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
