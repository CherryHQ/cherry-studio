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
    pipelineVersion: 2
  } as MediaExecutionConfig,
  probe: vi.fn(),
  extractAudio: vi.fn(),
  extractFrames: vi.fn(),
  detectSceneChanges: vi.fn(),
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
    if (name === 'AiService') return { transcribe: runtime.transcribe, generateSpeech: runtime.generateSpeech }
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

import { VoiceRuntimeError } from '@main/ai/voice/VoiceRuntimeError'
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
      vision: {
        uniqueModelId: 'openai::gpt-4o',
        providerId: 'openai',
        modelId: 'gpt-4o',
        endpointType: 'openai-chat-completions',
        baseUrl: 'https://api.openai.com/v1',
        sdkConfig: { providerId: 'openai-chat', providerSettings: { apiKey: 'secret-a' }, modelId: 'gpt-4o' }
      },
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
      vision: {
        uniqueModelId: 'openai::gpt-4o',
        providerId: 'openai',
        modelId: 'gpt-4o',
        endpointType: 'openai-chat-completions',
        baseUrl: 'https://api.openai.com/v1',
        sdkConfig: { providerId: 'openai-chat', providerSettings: { apiKey: 'secret-a' }, modelId: 'gpt-4o' }
      },
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
