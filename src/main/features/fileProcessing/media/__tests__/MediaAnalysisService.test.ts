import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as AiCoreModule from '@cherrystudio/ai-core'
import { createAiUsageCaptureContext } from '@main/ai/utils/usageCapture'
import { APPLE_ASR_MODEL_ID, QWEN3_ASR_MODEL_ID } from '@shared/ai/localVoice'
import { TranscriptionInputKind, TranscriptionOutputKind } from '@shared/ai/voice'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { MEDIA_PIPELINE_VERSION } from '@shared/types/mediaAnalysis'

import type * as MediaExecutionConfigModule from '../mediaExecutionConfig'
import type { MediaExecutionConfig, MediaVisionExecutionConfig } from '../mediaExecutionConfig'

const visionExecution = (): MediaVisionExecutionConfig => ({
  uniqueModelId: 'openai::gpt-4o',
  providerId: 'openai',
  modelId: 'gpt-4o',
  endpointType: 'openai-chat-completions',
  baseUrl: 'https://api.openai.com/v1',
  sdkConfig: { providerId: 'openai-chat', providerSettings: { apiKey: 'secret-a' }, modelId: 'gpt-4o' },
  usage: createAiUsageCaptureContext({
    providerId: 'openai',
    providerName: 'OpenAI',
    modelId: 'gpt-4o',
    modelName: 'GPT-4o',
    pricing: {
      input: { perMillionTokens: 2.5, currency: 'USD' },
      output: { perMillionTokens: 10, currency: 'USD' }
    },
    billing: { defaultMultiplier: 2, scheduleEnabled: false, timeZone: 'UTC', periods: [] },
    trustProviderReportedCost: true,
    reportedCostCurrency: 'USD',
    credentialReceipt: { attribution: 'explicit', id: 'key-a', masked: 'sk-a****aaaa' }
  })
})

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
    pipelineVersion: 2
  } as MediaExecutionConfig,
  probe: vi.fn(),
  extractAudio: vi.fn(),
  extractFrames: vi.fn(),
  detectSceneChanges: vi.fn(),
  transcribe: vi.fn(),
  closeTranscription: vi.fn(async () => undefined),
  ocrImage: vi.fn(),
  generateText: vi.fn()
}))

vi.mock('@cherrystudio/ai-core', async (importOriginal) => {
  const actual = await importOriginal<typeof AiCoreModule>()
  return { ...actual, generateText: runtime.generateText }
})
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
vi.mock('@main/ai/voice/execution', () => ({
  startTranscription: (request: unknown, signal?: AbortSignal) => {
    const closed = runtime.closeTranscription()
    void closed.catch(() => undefined)
    return {
      completed: runtime.transcribe(request, signal),
      closed
    }
  }
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mocked = mockApplicationFactory({
    CacheService: {
      get: (key: string) => runtime.cache.get(key),
      set: (key: string, value: unknown) => runtime.cache.set(key, value)
    }
  })
  const delegated = mocked.application.get.getMockImplementation()
  mocked.application.get.mockImplementation((name: string) => {
    if (name === 'FileProcessingService') return { ocrImage: runtime.ocrImage }
    return delegated?.call(mocked.application, name)
  })
  const delegatedOptional = mocked.application.getOptional.getMockImplementation()
  mocked.application.getOptional.mockImplementation(((name: string) => {
    if (name === 'MediaFfmpegService') {
      return {
        probe: runtime.probe,
        extractAudio: runtime.extractAudio,
        extractFrames: runtime.extractFrames,
        detectSceneChanges: runtime.detectSceneChanges
      }
    }
    return delegatedOptional?.call(mocked.application, name)
  }) as (name: string) => undefined)
  mocked.application.getPath.mockImplementation((_key: string, filename?: string) =>
    filename ? join(runtime.tempRoot, filename) : runtime.tempRoot
  )
  return mocked
})

import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import { VoiceCleanupError, VoiceRuntimeError } from '@main/ai/voice/VoiceRuntimeError'
import { BaseService } from '@main/core/lifecycle'

import { MediaAnalysisService } from '../MediaAnalysisService'
import { planFrameTimestamps } from '../probeClassification'

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
  runtime.detectSceneChanges.mockReset().mockResolvedValue({ changes: [] })
  runtime.transcribe.mockReset().mockResolvedValue({
    text: 'hello',
    segments: [{ text: 'hello', startSecond: 1, endSecond: 2 }]
  })
  runtime.closeTranscription.mockReset().mockResolvedValue(undefined)
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
      {
        modelId: APPLE_ASR_MODEL_ID,
        input: { kind: TranscriptionInputKind.Audio, audio: expect.any(Uint8Array) },
        output: TranscriptionOutputKind.Final,
        options: { language: 'en-US' }
      },
      undefined
    )
    expect(await readdir(runtime.tempRoot)).toEqual([])
  })

  it('shifts WAV-relative speech onto the source timeline when audio starts later than the container', async () => {
    runtime.probe.mockResolvedValue({
      durationMs: 10_000,
      hasAudio: true,
      hasVideo: true,
      mime: 'video/mp4',
      kind: 'video',
      audioStartMs: 2_000
    })
    runtime.extractAudio.mockImplementation(async ({ outputDir }) => {
      const path = join(outputDir, 'chunk.wav')
      await writeFile(path, Buffer.from('RIFF-test'))
      return { chunks: [{ path, startMs: 0, endMs: 8_000, byteLength: 9 }], sampleRateHz: 16000, channels: 1 }
    })
    runtime.transcribe.mockResolvedValue({
      text: 'hello',
      segments: [{ text: 'hello', startSecond: 0.25, endSecond: 0.75 }]
    })

    const analysis = await service.analyze(file)
    expect(analysis.audio?.segments).toEqual([{ startMs: 2_250, endMs: 2_750, text: 'hello' }])
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

  it('retains completed speech when a later audio chunk fails and retries the analysis', async () => {
    runtime.extractAudio.mockImplementation(async ({ outputDir }) => {
      const firstPath = join(outputDir, 'first.wav')
      const secondPath = join(outputDir, 'second.wav')
      await writeFile(firstPath, Buffer.from('RIFF-first'))
      await writeFile(secondPath, Buffer.from('RIFF-second'))
      return {
        chunks: [
          { path: firstPath, startMs: 0, endMs: 5_000, byteLength: 10 },
          { path: secondPath, startMs: 5_000, endMs: 10_000, byteLength: 11 }
        ],
        sampleRateHz: 16000,
        channels: 1
      }
    })
    runtime.transcribe
      .mockResolvedValueOnce({
        text: 'first phrase',
        segments: [{ text: 'first phrase', startSecond: 1, endSecond: 2 }]
      })
      .mockRejectedValueOnce(new Error('second chunk failed'))

    const analysis = await service.analyze(file)
    expect(analysis.audio?.segments).toEqual([{ startMs: 1_000, endMs: 2_000, text: 'first phrase' }])
    expect(analysis.warnings).toContain('audio_transcription_failed')
    expect(runtime.cache.size).toBe(0)

    await service.analyze(file)
    expect(runtime.extractAudio).toHaveBeenCalledTimes(2)
  })

  it('retains completed speech when a later chunk cannot be read', async () => {
    runtime.extractAudio.mockImplementation(async ({ outputDir }) => {
      const firstPath = join(outputDir, 'first.wav')
      await writeFile(firstPath, Buffer.from('RIFF-first'))
      return {
        chunks: [
          { path: firstPath, startMs: 0, endMs: 5_000, byteLength: 10 },
          { path: join(outputDir, 'missing.wav'), startMs: 5_000, endMs: 10_000, byteLength: 10 }
        ],
        sampleRateHz: 16000,
        channels: 1
      }
    })

    const analysis = await service.analyze(file)
    expect(analysis.audio?.segments).toEqual([{ startMs: 1_000, endMs: 2_000, text: 'hello' }])
    expect(analysis.warnings).toContain('audio_transcription_failed')
    expect(runtime.cache.size).toBe(0)
  })

  it('keeps useful video OCR when no ASR model is configured', async () => {
    runtime.config = {
      ...runtime.config,
      asr: null,
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
    runtime.extractFrames.mockImplementation(async ({ outputDir }) => {
      const path = join(outputDir, 'frame.jpg')
      await writeFile(path, Buffer.from('jpeg'))
      return { frames: [{ path, timestampMs: 4_000 }] }
    })
    runtime.ocrImage.mockResolvedValue('Agenda')

    const analysis = await service.analyze(file)
    expect(analysis.audio).toBeUndefined()
    expect(analysis.visuals).toEqual([{ timestampMs: 4_000, ocrText: 'Agenda' }])
    expect(analysis.warnings).toContain('audio_transcription_failed')
  })

  it('rejects audio-only media when no ASR model is configured', async () => {
    runtime.config = { ...runtime.config, asr: null }
    await expect(service.analyze(file)).rejects.toMatchObject({ code: 'unusable_media_analysis' })
  })

  it('treats no_speech as a successful empty transcription', async () => {
    runtime.transcribe.mockRejectedValue(new VoiceRuntimeError('no_speech'))
    const analysis = await service.analyze(file)
    expect(analysis.audio).toEqual({ segments: [] })
    expect(analysis.warnings).toContain('no_speech')
    await service.analyze(file)
    expect(runtime.transcribe).toHaveBeenCalledTimes(1)
  })

  it('treats a resolved empty transcript as successful silence', async () => {
    runtime.transcribe.mockResolvedValue({ text: '   ', segments: [] })

    const analysis = await service.analyze(file)

    expect(analysis.audio).toEqual({ segments: [] })
    expect(analysis.warnings).toContain('no_speech')
    await service.analyze(file)
    expect(runtime.transcribe).toHaveBeenCalledTimes(1)
  })

  it('maps Qwen3 text without segment times onto the source chunk window', async () => {
    runtime.config = { ...runtime.config, asr: { modelId: QWEN3_ASR_MODEL_ID } }
    runtime.probe.mockResolvedValue({
      durationMs: 10_000,
      hasAudio: true,
      hasVideo: false,
      mime: 'audio/mp4',
      kind: 'audio',
      audioStartMs: 2_000
    })
    runtime.extractAudio.mockImplementation(async ({ outputDir }) => {
      const path = join(outputDir, 'chunk.wav')
      await writeFile(path, Buffer.from('RIFF-test'))
      return { chunks: [{ path, startMs: 1_000, endMs: 4_000, byteLength: 9 }], sampleRateHz: 16000, channels: 1 }
    })
    runtime.transcribe.mockResolvedValue({ text: '明天开会', segments: [] })

    const analysis = await service.analyze(file)

    expect(analysis.audio?.segments).toEqual([{ startMs: 3_000, endMs: 6_000, text: '明天开会' }])
    expect(analysis.warnings).not.toContain('no_speech')
  })

  it('keeps the no-speech warning when a silent chunk resolves beside spoken audio', async () => {
    runtime.extractAudio.mockImplementation(async ({ outputDir }) => {
      const silentPath = join(outputDir, 'silent.wav')
      const spokenPath = join(outputDir, 'spoken.wav')
      await writeFile(silentPath, Buffer.from('RIFF-silent'))
      await writeFile(spokenPath, Buffer.from('RIFF-spoken'))
      return {
        chunks: [
          { path: silentPath, startMs: 0, endMs: 4_000, byteLength: 11 },
          { path: spokenPath, startMs: 4_000, endMs: 8_000, byteLength: 11 }
        ],
        sampleRateHz: 16000,
        channels: 1
      }
    })
    runtime.transcribe.mockResolvedValueOnce({ text: '   ', segments: [] }).mockResolvedValueOnce({
      text: 'hello',
      segments: [{ text: 'hello', startSecond: 0.5, endSecond: 1.5 }]
    })

    const analysis = await service.analyze(file)

    expect(analysis.audio?.segments).toEqual([{ startMs: 4_500, endMs: 5_500, text: 'hello' }])
    expect(analysis.warnings).toContain('no_speech')
  })

  it('keeps later speech and the no-speech warning when an earlier chunk throws no_speech', async () => {
    runtime.extractAudio.mockImplementation(async ({ outputDir }) => {
      const silentPath = join(outputDir, 'silent.wav')
      const spokenPath = join(outputDir, 'spoken.wav')
      await writeFile(silentPath, Buffer.from('RIFF-silent'))
      await writeFile(spokenPath, Buffer.from('RIFF-spoken'))
      return {
        chunks: [
          { path: silentPath, startMs: 0, endMs: 4_000, byteLength: 11 },
          { path: spokenPath, startMs: 4_000, endMs: 8_000, byteLength: 11 }
        ],
        sampleRateHz: 16000,
        channels: 1
      }
    })
    runtime.transcribe.mockRejectedValueOnce(new VoiceRuntimeError('no_speech')).mockResolvedValueOnce({
      text: 'hello',
      segments: [{ text: 'hello', startSecond: 0.5, endSecond: 1.5 }]
    })

    const analysis = await service.analyze(file)

    expect(analysis.audio?.segments).toEqual([{ startMs: 4_500, endMs: 5_500, text: 'hello' }])
    expect(analysis.warnings).toContain('no_speech')
  })

  it('propagates cancellation from an in-flight transcription and removes its job directory', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled')
    runtime.transcribe.mockImplementation(
      (_request: unknown, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          if (!signal) {
            reject(new Error('transcription received no signal'))
            return
          }
          if (signal.aborted) {
            reject(signal.reason)
            return
          }
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )

    const pending = service.analyze(file, controller.signal)
    await vi.waitFor(() => expect(runtime.transcribe).toHaveBeenCalledOnce())
    controller.abort(reason)

    await expect(pending).rejects.toBe(reason)
    expect(await readdir(runtime.tempRoot)).toEqual([])
  })

  it('does not publish a transcript when transcription cleanup fails', async () => {
    runtime.transcribe.mockResolvedValue({
      text: 'hello',
      segments: [{ text: 'hello', startSecond: 1, endSecond: 2 }]
    })
    runtime.closeTranscription.mockRejectedValue(new VoiceCleanupError())

    await expect(service.analyze(file)).rejects.toMatchObject({ code: 'unusable_media_analysis' })
    expect(runtime.cache.size).toBe(0)
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

  it('asks for a short cut between uniform samples without exceeding the frame budget', async () => {
    runtime.config = {
      ...runtime.config,
      budget: { maxFrames: 6, targetIntervalMs: 4_000, maxEdgePx: 640, jpegQuality: 70 },
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
      durationMs: 16_000,
      hasAudio: false,
      hasVideo: true,
      mime: 'video/mp4',
      kind: 'video'
    })
    runtime.detectSceneChanges.mockResolvedValue({
      changes: [
        { timestampMs: 5_200, score: 0.91 },
        { timestampMs: 10_000, score: 0.8 }
      ]
    })
    runtime.extractFrames.mockImplementation(async ({ outputDir, timestampsMs }) => {
      const path = join(outputDir, 'frame.jpg')
      await writeFile(path, Buffer.from('jpeg'))
      return { frames: timestampsMs.map((timestampMs: number) => ({ path, timestampMs })) }
    })
    runtime.ocrImage.mockResolvedValue('Cut')

    await service.analyze(file)
    const timestamps = runtime.extractFrames.mock.calls[0]?.[0].timestampsMs as number[]
    expect(timestamps.length).toBeLessThanOrEqual(6)
    expect(timestamps[0]).toBe(0)
    expect(timestamps.at(-1)).toBeGreaterThan(15_000)
    expect(timestamps).toEqual(expect.arrayContaining([5_200, 10_000]))
    expect(runtime.ocrImage).toHaveBeenCalledTimes(timestamps.length)
  })

  it('keeps uniform coverage when scene detection fails', async () => {
    runtime.config = {
      ...runtime.config,
      budget: { maxFrames: 4, targetIntervalMs: 4_000, maxEdgePx: 640, jpegQuality: 70 },
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
      durationMs: 60_000,
      hasAudio: false,
      hasVideo: true,
      mime: 'video/mp4',
      kind: 'video'
    })
    runtime.detectSceneChanges.mockRejectedValue(new Error('scene filter unavailable'))
    runtime.extractFrames.mockImplementation(async ({ outputDir, timestampsMs }) => {
      const path = join(outputDir, 'frame.jpg')
      await writeFile(path, Buffer.from('jpeg'))
      return { frames: [{ path, timestampMs: timestampsMs[0] }] }
    })
    runtime.ocrImage.mockResolvedValue('Slide')

    const analysis = await service.analyze(file)
    expect(runtime.extractFrames.mock.calls[0]?.[0].timestampsMs).toEqual(planFrameTimestamps(60_000, 4, 4_000))
    expect(analysis.visuals).toEqual([{ timestampMs: 0, ocrText: 'Slide' }])
    expect(analysis.warnings).not.toContain('visual_analysis_failed')
  })

  it('does not send near-duplicate frames to OCR', async () => {
    const sharp = (await import('sharp')).default
    const jpeg = (background: string) =>
      sharp({ create: { width: 32, height: 32, channels: 3, background } })
        .jpeg({ quality: 80 })
        .toBuffer()
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
      durationMs: 12_000,
      hasAudio: false,
      hasVideo: true,
      mime: 'video/mp4',
      kind: 'video'
    })
    runtime.extractFrames.mockImplementation(async ({ outputDir }) => {
      const red = join(outputDir, 'red.jpg')
      const redAgain = join(outputDir, 'red-again.jpg')
      const blue = join(outputDir, 'blue.jpg')
      await writeFile(red, await jpeg('red'))
      await writeFile(redAgain, await jpeg('red'))
      await writeFile(blue, await jpeg('blue'))
      return {
        frames: [
          { path: red, timestampMs: 0 },
          { path: redAgain, timestampMs: 4_000 },
          { path: blue, timestampMs: 8_000 }
        ]
      }
    })
    runtime.ocrImage.mockImplementation(async (image: { path: string }) =>
      image.path.endsWith('blue.jpg') ? 'Blue' : 'Red'
    )

    const analysis = await service.analyze(file)
    expect(runtime.ocrImage).toHaveBeenCalledTimes(2)
    expect(analysis.visuals?.map((frame) => frame.timestampMs)).toEqual([0, 8_000])
    expect(analysis.visuals?.map((frame) => frame.ocrText)).toEqual(['Red', 'Blue'])
  })

  it('aborts scene detection and removes the job directory', async () => {
    runtime.probe.mockResolvedValue({
      durationMs: 20_000,
      hasAudio: false,
      hasVideo: true,
      mime: 'video/mp4',
      kind: 'video'
    })
    const controller = new AbortController()
    const reason = new Error('cancel scenes')
    runtime.detectSceneChanges.mockImplementation(
      async (_input: unknown, signal: AbortSignal) =>
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const pending = service.analyze(file, controller.signal)
    await vi.waitFor(() => expect(runtime.detectSceneChanges).toHaveBeenCalledOnce())
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    expect(runtime.extractFrames).not.toHaveBeenCalled()
    expect(await readdir(runtime.tempRoot)).toEqual([])
  })

  it('keeps completed vision summaries when a later batch fails', async () => {
    runtime.config = {
      ...runtime.config,
      asr: null,
      vision: visionExecution(),
      budget: { maxFrames: 7, targetIntervalMs: 1_000, maxEdgePx: 640, jpegQuality: 70 }
    }
    runtime.probe.mockResolvedValue({
      durationMs: 60_000,
      hasAudio: false,
      hasVideo: true,
      mime: 'video/mp4',
      kind: 'video'
    })
    runtime.extractFrames.mockImplementation(async ({ outputDir, timestampsMs }) => ({
      frames: await Promise.all(
        timestampsMs.map(async (timestampMs: number) => {
          const path = join(outputDir, `frame-${timestampMs}.jpg`)
          await writeFile(path, Buffer.from('jpeg'))
          return { path, timestampMs }
        })
      )
    }))
    runtime.generateText
      .mockImplementationOnce(
        async (
          _providerId: string,
          _settings: unknown,
          request: { messages: Array<{ content: Array<{ type: string; text?: string }> }> }
        ) => {
          const lines = request.messages[0]?.content.flatMap((part) =>
            part.type === 'text' && part.text?.startsWith('FRAME_') ? [`${part.text}: kept`] : []
          )
          return { text: lines?.join('\n') ?? '' }
        }
      )
      .mockRejectedValueOnce(new Error('vision provider rejected the batch'))

    const analysis = await service.analyze(file)
    const timestamps = runtime.extractFrames.mock.calls[0]?.[0].timestampsMs as number[]

    expect(timestamps).toHaveLength(7)
    expect(runtime.generateText).toHaveBeenCalledTimes(2)
    expect(analysis.audio).toBeUndefined()
    expect(analysis.visuals?.flatMap((frame) => (frame.summary ? [frame.timestampMs] : []))).toEqual(
      timestamps.slice(0, 6)
    )
    expect(analysis.visuals?.filter((frame) => frame.summary).every((frame) => frame.summary === 'kept')).toBe(true)
    expect(analysis.warnings).toContain('vision_failed')
    expect(analysis.warnings).not.toContain('visual_analysis_failed')
  })

  it('propagates cancellation from a later vision batch', async () => {
    runtime.config = {
      ...runtime.config,
      asr: null,
      vision: visionExecution(),
      budget: { maxFrames: 7, targetIntervalMs: 1_000, maxEdgePx: 640, jpegQuality: 70 }
    }
    runtime.probe.mockResolvedValue({
      durationMs: 60_000,
      hasAudio: false,
      hasVideo: true,
      mime: 'video/mp4',
      kind: 'video'
    })
    runtime.extractFrames.mockImplementation(async ({ outputDir, timestampsMs }) => ({
      frames: await Promise.all(
        timestampsMs.map(async (timestampMs: number) => {
          const path = join(outputDir, `frame-${timestampMs}.jpg`)
          await writeFile(path, Buffer.from('jpeg'))
          return { path, timestampMs }
        })
      )
    }))
    const controller = new AbortController()
    const reason = new Error('cancel vision')
    runtime.generateText.mockResolvedValueOnce({ text: 'FRAME_0: first' }).mockImplementationOnce(async () => {
      controller.abort(reason)
      throw reason
    })

    await expect(service.analyze(file, controller.signal)).rejects.toBe(reason)
    expect(runtime.generateText).toHaveBeenCalledTimes(2)
  })

  it('records each vision batch through the application usage-capture plugin', async () => {
    runtime.config = {
      ...runtime.config,
      asr: null,
      vision: visionExecution(),
      budget: { maxFrames: 1, targetIntervalMs: 4_000, maxEdgePx: 640, jpegQuality: 70 }
    }
    runtime.probe.mockResolvedValue({
      durationMs: 10_000,
      hasAudio: false,
      hasVideo: true,
      mime: 'video/mp4',
      kind: 'video'
    })
    runtime.extractFrames.mockImplementation(async ({ outputDir, timestampsMs }) => ({
      frames: await Promise.all(
        timestampsMs.map(async (timestampMs: number) => {
          const path = join(outputDir, `frame-${timestampMs}.jpg`)
          await writeFile(path, Buffer.from('jpeg'))
          return { path, timestampMs }
        })
      )
    }))
    runtime.generateText.mockResolvedValue({ text: 'FRAME_0: kept' })

    await service.analyze(file)

    const plugins = runtime.generateText.mock.calls[0]?.[3] as Array<{
      name: string
      configureContext?: (context: {
        middlewares?: Array<{ wrapGenerate: (args: unknown) => Promise<unknown> }>
      }) => void
    }>
    expect(plugins?.map((plugin) => plugin.name)).toEqual(['ai-usage-capture'])
    const requestContext: {
      middlewares?: Array<{ wrapGenerate: (args: unknown) => Promise<unknown> }>
    } = {}
    plugins[0]?.configureContext?.(requestContext)
    const record = vi.spyOn(aiUsageRecordService, 'recordInvocation').mockImplementation(() => undefined)
    await requestContext.middlewares?.[0]?.wrapGenerate({
      doGenerate: async () => ({ usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 } })
    })
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        modality: 'language',
        usage: expect.objectContaining({ inputTokens: 4, outputTokens: 6 }),
        context: expect.objectContaining({
          providerId: 'openai',
          providerName: 'OpenAI',
          modelId: 'gpt-4o',
          modelName: 'GPT-4o',
          trustProviderReportedCost: true,
          reportedCostCurrency: 'USD',
          credentialReceipt: { attribution: 'explicit', id: 'key-a', masked: 'sk-a****aaaa' },
          pricingSnapshot: expect.objectContaining({
            inputPerMillionTokens: 5,
            outputPerMillionTokens: 20,
            billing: expect.objectContaining({ mode: 'multiplier', multiplier: 2 })
          })
        })
      })
    )
  })

  it('retries ASR after a recoverable transcription failure instead of caching it', async () => {
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
    runtime.extractFrames.mockImplementation(async ({ outputDir }) => {
      const path = join(outputDir, 'frame.jpg')
      await writeFile(path, Buffer.from('jpeg'))
      return { frames: [{ path, timestampMs: 4_000 }] }
    })
    runtime.ocrImage.mockResolvedValue('Agenda')
    runtime.transcribe
      .mockRejectedValueOnce(new Error('asr assets unavailable'))
      .mockResolvedValue({ text: 'hello', segments: [{ text: 'hello', startSecond: 1, endSecond: 2 }] })

    const failed = await service.analyze(file)
    expect(failed.audio).toBeUndefined()
    expect(failed.visuals).toEqual([{ timestampMs: 4_000, ocrText: 'Agenda' }])
    expect(failed.warnings).toContain('audio_transcription_failed')
    expect(runtime.cache.size).toBe(0)

    const recovered = await service.analyze(file)
    expect(recovered.audio?.segments).toEqual([{ startMs: 6_000, endMs: 7_000, text: 'hello' }])
    expect(recovered.visuals).toEqual([{ timestampMs: 4_000, ocrText: 'Agenda' }])
    expect(recovered.warnings).not.toContain('audio_transcription_failed')
    expect(runtime.transcribe).toHaveBeenCalledTimes(2)
    expect(runtime.cache.size).toBe(1)

    await service.analyze(file)
    expect(runtime.transcribe).toHaveBeenCalledTimes(2)
  })

  it('retries frame extraction after a recoverable visual failure instead of caching it', async () => {
    runtime.probe.mockResolvedValue({
      durationMs: 10_000,
      hasAudio: true,
      hasVideo: true,
      mime: 'video/mp4',
      kind: 'video'
    })
    runtime.extractFrames.mockRejectedValueOnce(new Error('frame extraction unavailable'))
    runtime.extractFrames.mockImplementation(async ({ outputDir }) => {
      const framePath = join(outputDir, 'frame.jpg')
      await writeFile(framePath, Buffer.from('jpeg'))
      return { frames: [{ path: framePath, timestampMs: 0 }] }
    })

    const failed = await service.analyze(file)
    expect(failed.audio?.segments).toEqual([{ startMs: 6_000, endMs: 7_000, text: 'hello' }])
    expect(failed.visuals).toBeUndefined()
    expect(failed.warnings).toContain('visual_analysis_failed')
    expect(runtime.cache.size).toBe(0)

    const recovered = await service.analyze(file)
    expect(recovered.audio?.segments).toEqual([{ startMs: 6_000, endMs: 7_000, text: 'hello' }])
    expect(recovered.visuals).toEqual([{ timestampMs: 0 }])
    expect(recovered.warnings).not.toContain('visual_analysis_failed')
    expect(recovered.warnings).toContain('vision_model_unavailable')
    expect(runtime.extractFrames).toHaveBeenCalledTimes(2)
    expect(runtime.cache.size).toBe(1)

    await service.analyze(file)
    expect(runtime.extractFrames).toHaveBeenCalledTimes(2)
  })
})
