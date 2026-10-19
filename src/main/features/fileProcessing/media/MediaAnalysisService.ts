import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { application } from '@application'
import { generateText as aiCoreGenerateText } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { createAiUsagePlugin } from '@main/ai/hooks/billingHook'
import type { AppProviderSettingsMap } from '@main/ai/types'
import { VoiceRuntimeError } from '@main/ai/voice/VoiceRuntimeError'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { resolveFileProcessingFileInfo } from '@main/features/fileProcessing/tasks/jobExecution'
import type { FileHandle } from '@shared/data/types/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import {
  MEDIA_ANALYSIS_VERSION,
  type MediaAnalysis,
  type MediaAnalysisWarningCode,
  type MediaAudioSegment,
  type MediaVisualFrame
} from '@shared/types/mediaAnalysis'
import { formatMediaAnalysisCompact, formatMediaAnalysisFull, isMediaAnalysis } from '@shared/utils/mediaAnalysis'

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
import {
  hashMediaExecutionConfig,
  resolveMediaExecutionConfig,
  type MediaExecutionConfig,
  type MediaVisionExecutionConfig
} from './mediaExecutionConfig'
import type { MediaFfmpegService } from './MediaFfmpegService'
import type { ClassifiedMediaProbe } from './probeClassification'

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
  constructor(readonly code: 'unusable_media_analysis') {
    super(code)
    this.name = 'MediaAnalysisError'
  }
}

@Injectable('MediaAnalysisService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['AiService', 'FileManager', 'FileProcessingService', 'MediaFfmpegService'])
export class MediaAnalysisService extends BaseService {
  async probe(file: FileHandle, signal?: AbortSignal): Promise<ClassifiedMediaProbe> {
    signal?.throwIfAborted()
    const fileInfo = await resolveFileProcessingFileInfo(file)
    return this.mediaFfmpeg().probe({ filePath: fileInfo.path, fallbackExt: fileInfo.ext ?? undefined }, signal)
  }

  async analyze(file: FileHandle, signal?: AbortSignal): Promise<MediaAnalysis> {
    signal?.throwIfAborted()
    const execution = await resolveMediaExecutionConfig()
    const fileInfo = await resolveFileProcessingFileInfo(file)
    const fileIdentity =
      file.kind === 'entry'
        ? `entry:${file.entryId}`
        : `path:${createHash('sha256').update(fileInfo.path).digest('hex').slice(0, 24)}`
    const cacheKey = [
      'media-analysis',
      fileIdentity,
      fileInfo.modifiedAt,
      fileInfo.size,
      hashMediaExecutionConfig(execution)
    ].join(':')
    const cache = application.get('CacheService')
    const cached = cache.get<unknown>(cacheKey)
    if (isMediaAnalysis(cached)) return cached

    const jobDir = application.getPath('app.temp', `media-analysis-${randomUUID()}`)
    await mkdir(jobDir, { recursive: true })
    try {
      const analysis = await this.runAnalysis(fileInfo.path, fileInfo.ext, jobDir, execution, signal)
      if (!analysis.warnings.some((warning) => RECOVERABLE_ANALYSIS_WARNINGS.has(warning))) {
        cache.set(cacheKey, analysis, CACHE_TTL_MS)
      }
      return analysis
    } finally {
      await rm(jobDir, { recursive: true, force: true }).catch(() => {
        logger.warn('Failed to remove media analysis job directory')
      })
    }
  }

  async analyzeToCompactText(file: FileHandle, signal?: AbortSignal): Promise<string> {
    return formatMediaAnalysisCompact(await this.analyze(file, signal))
  }

  async analyzeToFullText(file: FileHandle, signal?: AbortSignal): Promise<string> {
    return formatMediaAnalysisFull(await this.analyze(file, signal))
  }

  private async runAnalysis(
    filePath: string,
    fallbackExt: string | null,
    jobDir: string,
    execution: MediaExecutionConfig,
    signal?: AbortSignal
  ): Promise<MediaAnalysis> {
    signal?.throwIfAborted()
    const ffmpeg = this.mediaFfmpeg()
    const probe = await ffmpeg.probe({ filePath, fallbackExt: fallbackExt ?? undefined }, signal)
    const [audio, visual] = await Promise.all([
      this.analyzeAudio(filePath, probe, jobDir, execution, signal),
      this.analyzeVisuals(filePath, probe, jobDir, execution, signal)
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
      throw new MediaAnalysisError('unusable_media_analysis')
    }
    return analysis
  }

  private async analyzeAudio(
    filePath: string,
    probe: ClassifiedMediaProbe,
    jobDir: string,
    execution: MediaExecutionConfig,
    signal?: AbortSignal
  ): Promise<{ completed: boolean; segments: MediaAudioSegment[]; warnings: MediaAnalysisWarningCode[] }> {
    if (!probe.hasAudio) return { completed: false, segments: [], warnings: [] }
    if (!execution.asr) return { completed: false, segments: [], warnings: ['audio_transcription_failed'] }

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
        try {
          const bytes = new Uint8Array(await readFile(chunk.path))
          const result = await application
            .get('AiService')
            .transcribe(
              execution.asr.modelId,
              bytes,
              { ...(execution.asr.language && { language: execution.asr.language }) },
              signal ?? new AbortController().signal
            )
          if (result.segments.length > 0) {
            for (const segment of result.segments) {
              const text = segment.text.trim()
              if (!text) continue
              segments.push({
                startMs: sourceAudioMs(probe.audioStartMs, chunk.startMs, segment.startSecond),
                endMs: sourceAudioMs(probe.audioStartMs, chunk.startMs, segment.endSecond),
                text
              })
            }
          } else if (result.text.trim()) {
            segments.push({
              startMs: sourceAudioMs(probe.audioStartMs, chunk.startMs),
              endMs: sourceAudioMs(probe.audioStartMs, chunk.endMs),
              text: result.text.trim()
            })
          }
        } catch (error) {
          signal?.throwIfAborted()
          if (error instanceof VoiceRuntimeError && error.reason === 'no_speech') {
            noSpeech = true
            continue
          }
          throw error
        }
      }

      return { completed: true, segments, warnings: noSpeech || segments.length === 0 ? ['no_speech'] : [] }
    } catch {
      signal?.throwIfAborted()
      logger.warn('Audio analysis failed')
      return { completed: false, segments, warnings: ['audio_transcription_failed'] }
    }
  }

  private async analyzeVisuals(
    filePath: string,
    probe: ClassifiedMediaProbe,
    jobDir: string,
    execution: MediaExecutionConfig,
    signal?: AbortSignal
  ): Promise<{ frames: MediaVisualFrame[]; warnings: MediaAnalysisWarningCode[] }> {
    if (!probe.hasVideo) return { frames: [], warnings: [] }

    try {
      const outputDir = join(jobDir, 'frames')
      await mkdir(outputDir, { recursive: true })
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
      const timestampsMs = planAnalysisFrameTimestamps({
        durationMs: probe.durationMs,
        maxFrames: execution.budget.maxFrames,
        targetIntervalMs: execution.budget.targetIntervalMs,
        sceneChanges
      })
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
        await Promise.all(
          distinctFrames.map(async (frame) => {
            try {
              const text = (
                await application
                  .get('FileProcessingService')
                  .ocrImage(
                    { kind: 'path', path: AbsoluteFilePathSchema.parse(frame.path) },
                    signal,
                    execution.ocr!.processor
                  )
              ).trim()
              if (text) frames.set(frame.timestampMs, { ...frames.get(frame.timestampMs)!, ocrText: text })
            } catch {
              signal?.throwIfAborted()
              warnings.add('ocr_failed')
            }
          })
        )
      }

      if (execution.vision) {
        try {
          const summaries = await summarizeFrames(execution.vision, distinctFrames, signal)
          for (const [timestampMs, summary] of summaries) {
            frames.set(timestampMs, { ...frames.get(timestampMs)!, summary })
          }
          if (summaries.size < distinctFrames.length) warnings.add('vision_failed')
        } catch {
          signal?.throwIfAborted()
          warnings.add('vision_failed')
        }
      } else {
        warnings.add('vision_model_unavailable')
      }

      const ordered = [...frames.values()].sort((left, right) => left.timestampMs - right.timestampMs)
      if (!ordered.some((frame) => frame.summary?.trim() || frame.ocrText?.trim())) warnings.add('no_visual_content')
      return { frames: ordered, warnings: [...warnings] }
    } catch {
      signal?.throwIfAborted()
      logger.warn('Visual analysis failed')
      return { frames: [], warnings: ['visual_analysis_failed'] }
    }
  }

  // Declared @DependsOn: this service is excluded when MediaFfmpegService is.
  private mediaFfmpeg(): MediaFfmpegService {
    return application.getOptional('MediaFfmpegService') as MediaFfmpegService
  }
}

async function summarizeFrames(
  vision: MediaVisionExecutionConfig,
  frames: Array<{ path: string; timestampMs: number }>,
  signal?: AbortSignal
): Promise<Map<number, string>> {
  const summaries = new Map<number, string>()
  for (let index = 0; index < frames.length; index += VISION_BATCH_SIZE) {
    signal?.throwIfAborted()
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
      assignSummaries(batch, result.text, summaries)
    } catch {
      signal?.throwIfAborted()
    }
  }
  return summaries
}

function sourceAudioMs(audioStartMs: number | undefined, chunkMs: number, segmentSeconds = 0): number {
  return Math.max(0, audioStartMs ?? 0) + chunkMs + Math.round(segmentSeconds * 1000)
}

function assignSummaries(batch: Array<{ timestampMs: number }>, text: string, summaries: Map<number, string>): void {
  const timestamps = new Set(batch.map((frame) => frame.timestampMs))
  for (const line of text.split('\n')) {
    const match = /^\s*FRAME_(\d+)\s*:\s*(.+)\s*$/i.exec(line)
    if (!match) continue
    const timestampMs = Number(match[1])
    const summary = match[2]?.trim()
    if (timestamps.has(timestampMs) && summary) summaries.set(timestampMs, summary)
  }
}
