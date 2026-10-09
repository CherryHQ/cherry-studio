import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { APPLE_ASR_MODEL_ID } from '@shared/ai/localVoice'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { MEDIA_PIPELINE_VERSION } from '@shared/types/mediaAnalysis'

import type * as MediaExecutionConfigModule from '../mediaExecutionConfig'
import type { MediaExecutionConfig } from '../mediaExecutionConfig'

const runtime = vi.hoisted(() => ({
  tempRoot: '',
  cache: new Map<string, unknown>(),
  fileInfo: {
    path: '/fixture.mp4',
    ext: 'mp4',
    size: 10,
    modifiedAt: 100
  },
  config: {
    asr: { modelId: 'local-voice::apple-system-asr', language: 'en-US' },
    ocr: null,
    vision: null,
    budget: { maxFrames: 2, targetIntervalMs: 4_000, maxEdgePx: 640, jpegQuality: 70 },
    pipelineVersion: 1
  } as MediaExecutionConfig,
  probe: vi.fn(),
  extractAudio: vi.fn(),
  extractFrames: vi.fn(),
  transcribe: vi.fn(),
  generateSpeech: vi.fn(),
  ocrImage: vi.fn(),
  generateText: vi.fn()
}))

vi.mock('@cherrystudio/ai-core', () => ({ generateText: runtime.generateText }))
vi.mock('@main/features/fileProcessing/tasks/jobExecution', () => ({
  resolveFileProcessingFileInfo: vi.fn(async () => runtime.fileInfo)
}))
vi.mock('../mediaExecutionConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof MediaExecutionConfigModule>()
  return {
    ...actual,
    resolveMediaExecutionConfig: vi.fn(async () => runtime.config)
  }
})
vi.mock('@application', () => ({
  application: {
    getPath: (_key: string, filename?: string) => (filename ? join(runtime.tempRoot, filename) : runtime.tempRoot),
    get: (name: string) => {
      if (name === 'CacheService') {
        return {
          get: (key: string) => runtime.cache.get(key),
          set: (key: string, value: unknown) => runtime.cache.set(key, value)
        }
      }
      if (name === 'MediaFfmpegService') {
        return { probe: runtime.probe, extractAudio: runtime.extractAudio, extractFrames: runtime.extractFrames }
      }
      if (name === 'AiService') {
        return { transcribe: runtime.transcribe, generateSpeech: runtime.generateSpeech }
      }
      if (name === 'FileProcessingService') return { ocrImage: runtime.ocrImage }
      throw new Error(`Unexpected service: ${name}`)
    }
  }
}))

import { VoiceRuntimeError } from '@main/ai/voice/VoiceRuntimeError'
import { BaseService } from '@main/core/lifecycle'

import { MediaAnalysisService } from '../MediaAnalysisService'

const file = { kind: 'path' as const, path: AbsoluteFilePathSchema.parse('/fixture.mp4') }
let service: MediaAnalysisService

beforeEach(async () => {
  BaseService.resetInstances()
  runtime.tempRoot = await mkdtemp(join(tmpdir(), 'media-analysis-test-'))
  runtime.cache.clear()
  runtime.fileInfo.size = 10
  runtime.fileInfo.modifiedAt = 100
  runtime.config = {
    asr: { modelId: APPLE_ASR_MODEL_ID, language: 'en-US' },
    ocr: null,
    vision: null,
    budget: { maxFrames: 2, targetIntervalMs: 4_000, maxEdgePx: 640, jpegQuality: 70 },
    pipelineVersion: MEDIA_PIPELINE_VERSION
  }
  runtime.probe.mockReset().mockResolvedValue({
    durationMs: 10_000,
    hasAudio: true,
    hasVideo: false,
    mime: 'audio/mp4',
    kind: 'audio'
  })
  runtime.extractAudio.mockReset().mockImplementation(async ({ outputDir }) => {
    const path = join(outputDir, 'chunk.wav')
    await writeFile(path, Buffer.from('RIFF-test'))
    return { chunks: [{ path, startMs: 5_000, endMs: 10_000, byteLength: 9 }], sampleRateHz: 16000, channels: 1 }
  })
  runtime.extractFrames.mockReset().mockResolvedValue({ frames: [] })
  runtime.transcribe.mockReset().mockResolvedValue({
    text: 'hello',
    segments: [{ text: 'hello', startSecond: 1, endSecond: 2 }]
  })
  runtime.generateSpeech.mockReset()
  runtime.ocrImage.mockReset()
  runtime.generateText.mockReset()
  service = new MediaAnalysisService()
})

afterEach(async () => {
  await rm(runtime.tempRoot, { recursive: true, force: true })
  BaseService.resetInstances()
})

describe('MediaAnalysisService', () => {
  it('passes canonical WAV bytes through the selected ASR and offsets segment timestamps', async () => {
    const analysis = await service.analyze(file)
    expect(analysis.audio?.segments).toEqual([{ startMs: 6_000, endMs: 7_000, text: 'hello' }])
    expect(runtime.transcribe).toHaveBeenCalledWith(
      APPLE_ASR_MODEL_ID,
      expect.any(Uint8Array),
      { language: 'en-US' },
      expect.any(AbortSignal)
    )
    expect(runtime.generateSpeech).not.toHaveBeenCalled()
    expect(await readdir(runtime.tempRoot)).toEqual([])
  })

  it('keeps successful OCR when audio transcription fails', async () => {
    runtime.config = {
      ...runtime.config,
      ocr: {
        processor: {
          id: 'system',
          type: 'builtin',
          capabilities: [{ feature: 'image_to_text', inputs: ['image'], output: 'text' }]
        },
        identity: { processorId: 'system', modelId: '', apiHost: '', optionsJson: '{}' }
      }
    }
    runtime.probe.mockResolvedValue({
      durationMs: 10_000,
      hasAudio: true,
      hasVideo: true,
      mime: 'video/mp4',
      kind: 'video'
    })
    runtime.transcribe.mockRejectedValue(new Error('private ASR failure'))
    runtime.extractFrames.mockImplementation(async ({ outputDir }) => {
      const path = join(outputDir, 'frame.jpg')
      await writeFile(path, Buffer.from('jpeg'))
      return { frames: [{ path, timestampMs: 4_000 }] }
    })
    runtime.ocrImage.mockResolvedValue('Agenda')

    const analysis = await service.analyze(file)
    expect(analysis.audio).toBeUndefined()
    expect(analysis.visuals).toEqual([{ timestampMs: 4_000, ocrText: 'Agenda' }])
    expect(analysis.warnings).toEqual(
      expect.arrayContaining(['audio_transcription_failed', 'vision_model_unavailable'])
    )
  })

  it('treats no_speech as a successful empty transcription', async () => {
    runtime.transcribe.mockRejectedValue(new VoiceRuntimeError('no_speech'))
    const analysis = await service.analyze(file)
    expect(analysis.audio).toEqual({ segments: [] })
    expect(analysis.warnings).toContain('no_speech')
  })

  it('reuses the cache until the file version changes', async () => {
    await service.analyze(file)
    await service.analyze(file)
    expect(runtime.extractAudio).toHaveBeenCalledTimes(1)

    runtime.fileInfo.modifiedAt += 1
    await service.analyze(file)
    expect(runtime.extractAudio).toHaveBeenCalledTimes(2)
  })

  it('propagates abort and removes only its job directory', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled')
    runtime.extractAudio.mockImplementation(
      async (_input, signal: AbortSignal) =>
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const pending = service.analyze(file, controller.signal)
    await vi.waitFor(() => expect(runtime.extractAudio).toHaveBeenCalledOnce())
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    expect(await readdir(runtime.tempRoot)).toEqual([])
  })
})
