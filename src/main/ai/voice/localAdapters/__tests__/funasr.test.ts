import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { AsrInferenceService } from '@main/ai/localModel'
import { UtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'
import { FUNASR_MODEL_ID } from '@shared/ai/localVoice'

import { createLocalTranscriptionModel, downloadVoiceModel, getLocalVoiceStatus } from '../../localAdapters'

const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
  transcribe: vi.fn<AsrInferenceService['transcribe']>(),
  refreshStatus: vi.fn(),
  download: vi.fn()
}))
const transcriptCanary = 'PRIVATE_TRANSCRIPT_CANARY'
const CANONICAL_WAV_HEADER_BYTES = 44
const CANONICAL_WAV_BYTE_RATE = 32_000
const MAX_CANONICAL_WAV_BYTES = 32 * 1024 * 1024

/** 16 kHz mono PCM16 WAV. Duration is `dataBytes / 32000`, independent of the adapter. */
function canonicalPcmWav(dataBytes: number): Buffer {
  const audio = Buffer.alloc(CANONICAL_WAV_HEADER_BYTES + dataBytes)
  audio.write('RIFF', 0, 'ascii')
  audio.writeUInt32LE(audio.length - 8, 4)
  audio.write('WAVE', 8, 'ascii')
  audio.write('fmt ', 12, 'ascii')
  audio.writeUInt32LE(16, 16)
  audio.writeUInt16LE(1, 20)
  audio.writeUInt16LE(1, 22)
  audio.writeUInt32LE(16_000, 24)
  audio.writeUInt32LE(CANONICAL_WAV_BYTE_RATE, 28)
  audio.writeUInt16LE(2, 32)
  audio.writeUInt16LE(16, 34)
  audio.write('data', 36, 'ascii')
  audio.writeUInt32LE(dataBytes, 40)
  return audio
}

function stereoWav(): Buffer {
  const audio = canonicalPcmWav(2)
  audio.writeUInt16LE(2, 22)
  return audio
}

function canonicalWav(samples: number, channels = 1, fmtSize = 16): Uint8Array {
  const dataSize = samples * channels * 2
  const dataOffset = 20 + fmtSize + (fmtSize % 2)
  const audio = new Uint8Array(dataOffset + 8 + dataSize)
  const view = new DataView(audio.buffer)
  audio.set(new TextEncoder().encode('RIFF'), 0)
  view.setUint32(4, audio.byteLength - 8, true)
  audio.set(new TextEncoder().encode('WAVEfmt '), 8)
  view.setUint32(16, fmtSize, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, 16_000, true)
  view.setUint32(28, 16_000 * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  audio.set(new TextEncoder().encode('data'), dataOffset)
  view.setUint32(dataOffset + 4, dataSize, true)
  return audio
}

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
    if (name === 'CacheService') return { getShared: () => undefined }
    if (name === 'LocalModelService') return { refreshStatus: mocks.refreshStatus, download: mocks.download }
    if (name === 'AsrInferenceService') return { transcribe: mocks.transcribe }
    return { client: () => ({ request: mocks.decode }) }
  }) as never)
  mocks.refreshStatus.mockReturnValue({ status: 'ready' })
  mocks.decode.mockResolvedValue({ wav, durationSeconds: 2.5, sampleRate: 16000, channels: 1 })
  mocks.transcribe.mockImplementation(async (_modelId, source) => {
    assert(source.kind === 'wav')
    const { filePath } = source
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
  it('reports a resource download failure without exposing transport or filesystem details', async () => {
    mocks.download.mockRejectedValueOnce(new Error('private transport and disk path'))
    await expect(downloadVoiceModel(FUNASR_MODEL_ID)).rejects.toMatchObject({
      reason: 'download_failed',
      message: 'download_failed'
    })
  })

  it('decodes WebM, transcribes private WAV scratch, and returns timed segments', async () => {
    const audio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])
    const result = await createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({
      audio,
      mediaType: 'audio/webm;codecs=opus'
    })

    expect(result).toMatchObject({
      text: transcriptCanary,
      segments: [{ text: transcriptCanary, startSecond: 0.5, endSecond: 2 }],
      durationInSeconds: 2.5
    })
    expect(mocks.decode).toHaveBeenCalledOnce()
    expect(mocks.decode).toHaveBeenCalledWith(
      'decode',
      { audio, mimeType: 'audio/webm;codecs=opus' },
      { signal: expect.any(AbortSignal) }
    )
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

  it.each([16, 18])('transcribes WAV with a %i-byte fmt unchanged and reports the data duration', async (fmtSize) => {
    const bytes = canonicalWav(1600, 1, fmtSize)
    const backing = Buffer.alloc(bytes.byteLength + 2)
    backing.set(bytes, 1)
    const input = backing.subarray(1, -1)
    mocks.transcribe.mockImplementation(async (_modelId, source) => {
      assert(source.kind === 'wav')
      const { filePath } = source
      expect(await readFile(filePath)).toEqual(input)
      expect((await stat(dirname(filePath))).mode & 0o777).toBe(0o700)
      expect((await stat(filePath)).mode & 0o777).toBe(0o600)
      return { text: transcriptCanary, segments: [{ text: transcriptCanary, start: 0.5, end: 2 }] }
    })

    const result = await createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({
      audio: input,
      mediaType: 'audio/wav'
    })

    expect(result).toMatchObject({ text: transcriptCanary, durationInSeconds: 0.1 })
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(mocks.transcribe).toHaveBeenCalledOnce()
    expect(mockMainLoggerService.debug).toHaveBeenCalledWith('Local transcription completed', {
      modelId: FUNASR_MODEL_ID,
      status: 'completed',
      durationSeconds: 0.1,
      segmentCount: 1,
      transcriptNonEmpty: true
    })
    expect(await readdir(directory)).toEqual([])
  })

  it.each([
    ['truncated header', () => new Uint8Array(11)],
    ['17-byte fmt chunk', () => canonicalWav(1, 1, 17)],
    ['20-byte fmt chunk', () => canonicalWav(1, 1, 20)],
    ['40-byte fmt chunk', () => canonicalWav(1, 1, 40)],
    [
      '18-byte fmt chunk with nonzero extension size',
      () => {
        const audio = canonicalWav(1, 1, 18)
        new DataView(audio.buffer).setUint16(36, 1, true)
        return audio
      }
    ],
    [
      'wrong RIFF size',
      () => {
        const audio = canonicalWav(1)
        new DataView(audio.buffer).setUint32(4, 0, true)
        return audio
      }
    ],
    [
      'missing data chunk',
      () => {
        const audio = canonicalWav(1).slice(0, 36)
        new DataView(audio.buffer).setUint32(4, audio.byteLength - 8, true)
        return audio
      }
    ],
    ['empty data chunk', () => canonicalWav(0)],
    [
      'odd data chunk size',
      () => {
        const audio = canonicalWav(1)
        new DataView(audio.buffer).setUint32(40, 1, true)
        return audio
      }
    ]
  ])('rejects a WAV with %s before creating scratch', async (_case, makeAudio) => {
    await expect(
      createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({
        audio: makeAudio(),
        mediaType: 'audio/wav'
      })
    ).rejects.toMatchObject({ reason: 'invalid_audio' })
    expect(mocks.refreshStatus).not.toHaveBeenCalled()
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(mocks.transcribe).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])
  })

  it('rejects stereo PCM WAV before creating scratch', async () => {
    await expect(
      createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({
        audio: canonicalWav(1600, 2),
        mediaType: 'audio/wav'
      })
    ).rejects.toMatchObject({ reason: 'invalid_audio' })
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(mocks.transcribe).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])
  })

  it('rejects WAV input over 32 MiB before inference', async () => {
    await expect(
      createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({
        audio: new Uint8Array(32 * 1024 * 1024 + 1),
        mediaType: 'audio/wav'
      })
    ).rejects.toMatchObject({ reason: 'invalid_audio' })
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(mocks.transcribe).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])
  })

  it('rejects unsupported media types even when the bytes are a valid WAV', async () => {
    await expect(
      createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({
        audio: canonicalWav(1),
        mediaType: 'audio/mpeg'
      })
    ).rejects.toMatchObject({ reason: 'invalid_audio' })
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(mocks.transcribe).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])
  })

  it('rejects non-byte audio before creating scratch', async () => {
    await expect(
      createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({
        audio: 'not audio',
        mediaType: 'audio/wav'
      })
    ).rejects.toMatchObject({ reason: 'invalid_audio' })
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(mocks.transcribe).not.toHaveBeenCalled()
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

  it('normalizes protocol failures as worker crashes without exposing native details', async () => {
    const canary = 'PRIVATE_PROTOCOL_CANARY'
    mocks.transcribe.mockRejectedValue(
      new UtilityProcessError('PROCESS_PROTOCOL_ERROR', `${canary} at ${directory}/input.wav`, {
        processId: 'inference.asr'
      })
    )

    await expect(
      createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({
        audio: new TextEncoder().encode(canary),
        mediaType: 'audio/webm;codecs=opus'
      })
    ).rejects.toMatchObject({ reason: 'worker_crashed', message: 'worker_crashed' })
    expect(JSON.stringify(mockMainLoggerService.debug.mock.calls)).not.toContain(canary)
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
    mocks.transcribe.mockImplementation((_modelId, _source, signal) => {
      assert(signal)
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      )
    })

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
    ['downloading', { status: 'installing', reason: 'model_required', percent: 0 }],
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
    mocks.transcribe.mockImplementation((_modelId, _source, signal) => {
      assert(signal)
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
    })
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

  it('gives inference the original canonical WAV and its PCM duration', async () => {
    const audio = canonicalPcmWav(CANONICAL_WAV_BYTE_RATE)
    mocks.decode.mockRejectedValue(new Error('WebM decode must not see canonical WAV'))
    mocks.transcribe.mockImplementation(async (_modelId, source) => {
      assert(source.kind === 'wav')
      const { filePath } = source
      const written = await readFile(filePath)
      expect(Buffer.compare(written, audio)).toBe(0)
      expect((await stat(filePath)).mode & 0o777).toBe(0o600)
      return { text: transcriptCanary, segments: [{ text: transcriptCanary, start: 0, end: 1 }] }
    })

    const result = await createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({
      audio,
      mediaType: 'audio/wav'
    })

    expect(result).toMatchObject({
      text: transcriptCanary,
      segments: [{ text: transcriptCanary, startSecond: 0, endSecond: 1 }],
      durationInSeconds: 1
    })
    expect(await readdir(directory)).toEqual([])
  })

  it.each([
    ['malformed WAV bytes', Uint8Array.from([1, 2, 3, 4]), 'audio/wav'],
    ['a non-audio type', canonicalPcmWav(2), 'audio/mpeg'],
    ['stereo PCM', stereoWav(), 'audio/wav']
  ] as const)('rejects %s before decoding or inference', async (_label, audio, mediaType) => {
    mocks.decode.mockRejectedValue(new Error('decode must not run'))
    mocks.transcribe.mockRejectedValue(new Error('inference must not run'))

    await expect(
      createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({ audio, mediaType })
    ).rejects.toMatchObject({ reason: 'invalid_audio', message: 'invalid_audio' })
    expect(await readdir(directory)).toEqual([])
  })

  it('rejects a canonical WAV above 32 MiB before scratch or inference', async () => {
    const audio = canonicalPcmWav(MAX_CANONICAL_WAV_BYTES + 2 - CANONICAL_WAV_HEADER_BYTES)
    mocks.decode.mockRejectedValue(new Error('decode must not run'))
    mocks.transcribe.mockRejectedValue(new Error('inference must not run'))

    await expect(
      createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({ audio, mediaType: 'audio/wav' })
    ).rejects.toMatchObject({ reason: 'invalid_audio' })
    expect(await readdir(directory)).toEqual([])
  })

  it('transcribes a canonical WAV of exactly 32 MiB, including audio longer than five minutes', async () => {
    const audio = canonicalPcmWav(MAX_CANONICAL_WAV_BYTES - CANONICAL_WAV_HEADER_BYTES)
    expect(audio.length).toBe(MAX_CANONICAL_WAV_BYTES)
    mocks.decode.mockRejectedValue(new Error('WebM decode must not see canonical WAV'))
    mocks.transcribe.mockImplementation(async (_modelId, source) => {
      assert(source.kind === 'wav')
      const { filePath } = source
      expect(Buffer.compare(await readFile(filePath), audio)).toBe(0)
      return { text: transcriptCanary, segments: [] }
    })

    const result = await createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({
      audio,
      mediaType: 'audio/wav'
    })

    expect(result.durationInSeconds).toBeGreaterThan(300)
    expect(result.durationInSeconds).toBe(
      (MAX_CANONICAL_WAV_BYTES - CANONICAL_WAV_HEADER_BYTES) / CANONICAL_WAV_BYTE_RATE
    )
    expect(await readdir(directory)).toEqual([])
  })

  it('maps a 120s WAV inference deadline to timeout and removes scratch', async () => {
    const audio = canonicalPcmWav(2)
    const inferenceTimeout = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds: number) => {
      expect(milliseconds).toBe(120_000)
      return inferenceTimeout.signal
    })
    mocks.transcribe.mockImplementation((_modelId, _source, signal) => {
      assert(signal)
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      )
    })

    const work = createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({
      audio,
      mediaType: 'audio/wav'
    })
    await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalledOnce())
    inferenceTimeout.abort(new DOMException('private timeout details', 'TimeoutError'))

    await expect(work).rejects.toMatchObject({ reason: 'timeout', message: 'timeout' })
    expect(await readdir(directory)).toEqual([])
  })

  it('aborts canonical WAV inference and removes the scratch input', async () => {
    const audio = canonicalPcmWav(2)
    const controller = new AbortController()
    mocks.transcribe.mockImplementation((_modelId, _source, signal) => {
      assert(signal)
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
    })

    const work = createLocalTranscriptionModel(FUNASR_MODEL_ID, {}).doGenerate({
      audio,
      mediaType: 'audio/wav',
      abortSignal: controller.signal
    })
    await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalledOnce())
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(work).rejects.toMatchObject({ reason: 'aborted' })
    expect(await readdir(directory)).toEqual([])
  })
})
