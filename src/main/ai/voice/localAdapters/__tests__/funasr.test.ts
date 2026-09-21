import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { UtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'
import { FUNASR_MODEL_ID } from '@shared/ai/localVoice'

import { createLocalTranscriptionModel, getLocalVoiceStatus } from '../../localAdapters'

const mocks = vi.hoisted(() => ({ decode: vi.fn(), transcribe: vi.fn(), refreshStatus: vi.fn() }))
const transcriptCanary = 'PRIVATE_TRANSCRIPT_CANARY'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

let directory: string
const wav = Buffer.from('UklGRiYAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQIAAAAAAA==', 'base64')

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'funasr-adapter-'))
  vi.mocked(application.getPath).mockImplementation((_key, filename) =>
    filename ? join(directory, filename) : directory
  )
  vi.mocked(application.get).mockImplementation(((name: string) => {
    if (name === 'LocalModelService') return { refreshStatus: mocks.refreshStatus }
    if (name === 'AsrInferenceService') return { transcribe: mocks.transcribe }
    return { client: () => ({ request: mocks.decode }) }
  }) as never)
  mocks.refreshStatus.mockReturnValue({ status: 'ready' })
  mocks.decode.mockResolvedValue({ wav, durationSeconds: 2.5, sampleRate: 16000, channels: 1 })
  mocks.transcribe.mockImplementation(async ({ filePath }) => {
    expect(await readFile(filePath)).toEqual(wav)
    expect((await stat(dirname(filePath))).mode & 0o777).toBe(0o700)
    expect((await stat(filePath)).mode & 0o777).toBe(0o600)
    return { text: transcriptCanary, segments: [{ text: transcriptCanary, start: 0.5, end: 2 }] }
  })
  mockMainLoggerService.debug.mockClear()
})

afterEach(async () => {
  vi.restoreAllMocks()
  mocks.decode.mockReset()
  mocks.transcribe.mockReset()
  mocks.refreshStatus.mockReset()
  await rm(directory, { force: true, recursive: true })
})

describe('FunASR local adapter', () => {
  it('decodes WebM, transcribes private WAV scratch, and returns timed segments', async () => {
    const result = await createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({
      audio: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      mediaType: 'audio/webm;codecs=opus'
    })

    expect(result).toMatchObject({
      text: transcriptCanary,
      segments: [{ text: transcriptCanary, startSecond: 0.5, endSecond: 2 }],
      durationInSeconds: 2.5
    })
    expect(mockMainLoggerService.debug).toHaveBeenCalledWith('Local transcription completed', {
      modelId: FUNASR_MODEL_ID,
      status: 'completed',
      durationSeconds: 2.5,
      segmentCount: 1,
      transcriptNonEmpty: true
    })
    const logs = JSON.stringify(mockMainLoggerService.debug.mock.calls)
    expect(logs).not.toContain(transcriptCanary)
    expect(logs).not.toContain(directory)
    expect(await readdir(directory)).toEqual([])
  })

  it('rejects an explicit language because FunASR only supports automatic detection', async () => {
    await expect(
      createLocalTranscriptionModel(FUNASR_MODEL_ID, { language: 'zh-CN' }).doGenerate({
        audio: new Uint8Array([1]),
        mediaType: 'audio/webm;codecs=opus'
      })
    ).rejects.toMatchObject({ reason: 'invalid_request' })
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(mocks.transcribe).not.toHaveBeenCalled()
  })

  it('normalizes worker failures without exposing audio or private paths', async () => {
    const canary = 'PRIVATE_AUDIO_CANARY'
    mocks.transcribe.mockRejectedValue(
      new UtilityProcessError('PROCESS_EXITED', `${canary} at ${directory}/input.wav`, {
        processId: 'inference.asr',
        exitCode: 1
      })
    )

    await expect(
      createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({
        audio: new TextEncoder().encode(canary),
        mediaType: 'audio/webm;codecs=opus'
      })
    ).rejects.toMatchObject({ reason: 'worker_crashed', message: 'worker_crashed' })
    const logs = JSON.stringify(mockMainLoggerService.debug.mock.calls)
    expect(logs).not.toContain(canary)
    expect(logs).not.toContain(directory)
    expect(await readdir(directory)).toEqual([])
  })

  it('maps model initialization failures to a stable non-sensitive reason', async () => {
    mocks.transcribe.mockRejectedValue(
      new UtilityProcessError('PROCESS_REMOTE_ERROR', 'private native model failure', {
        processId: 'inference.asr',
        remote: {
          name: 'Error',
          message: 'private native model failure',
          code: 'ASR_MODEL_LOAD_FAILED'
        }
      })
    )

    await expect(
      createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({
        audio: new Uint8Array([1]),
        mediaType: 'audio/webm;codecs=opus'
      })
    ).rejects.toMatchObject({ reason: 'model_load_failed', message: 'model_load_failed' })
  })

  it('maps an inference deadline to the stable timeout reason', async () => {
    const decodeTimeout = new AbortController()
    const inferenceTimeout = new AbortController()
    vi.spyOn(AbortSignal, 'timeout')
      .mockReturnValueOnce(decodeTimeout.signal)
      .mockReturnValueOnce(inferenceTimeout.signal)
    mocks.transcribe.mockImplementation(
      (_source, signal) =>
        new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    )

    const work = createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({
      audio: new Uint8Array([1]),
      mediaType: 'audio/webm;codecs=opus'
    })
    await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalledOnce())
    inferenceTimeout.abort(new DOMException('private timeout details', 'TimeoutError'))

    await expect(work).rejects.toMatchObject({ reason: 'timeout', message: 'timeout' })
    expect(await readdir(directory)).toEqual([])
  })

  it.each([
    ['not_downloaded', { status: 'not_installed', reason: 'model_required' }],
    ['downloading', { status: 'installing', reason: 'model_required' }],
    ['ready', { status: 'ready' }],
    ['error', { status: 'failed', reason: 'download_failed' }],
    ['unsupported', { status: 'unsupported', reason: 'unsupported' }]
  ] as const)('maps local model status %s into Voice status', async (status, expected) => {
    mocks.refreshStatus.mockReturnValue({ status })
    await expect(getLocalVoiceStatus(FUNASR_MODEL_ID)).resolves.toEqual(expected)
  })

  it('does not start decoding until the model is ready', async () => {
    mocks.refreshStatus.mockReturnValue({ status: 'not_downloaded' })
    await expect(
      createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({
        audio: new Uint8Array([1]),
        mediaType: 'audio/webm;codecs=opus'
      })
    ).rejects.toMatchObject({ reason: 'model_required' })
    expect(mocks.decode).not.toHaveBeenCalled()
  })

  it('forwards caller cancellation and removes scratch', async () => {
    const controller = new AbortController()
    mocks.transcribe.mockImplementation(
      (_source, signal) =>
        new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
    )
    const work = createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({
      audio: new Uint8Array([1]),
      mediaType: 'audio/webm;codecs=opus',
      abortSignal: controller.signal
    })
    await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalledOnce())
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(work).rejects.toMatchObject({ reason: 'aborted' })
    expect(await readdir(directory)).toEqual([])
  })
})
