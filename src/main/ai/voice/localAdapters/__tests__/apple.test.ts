import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { SystemSpeechError } from '@cherrystudio/system-speech/contracts'
import { UtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'
import { APPLE_ASR_MODEL_ID, APPLE_TTS_MODEL_ID, FUNASR_MODEL_ID } from '@shared/ai/localVoice'

import {
  createLocalSpeechModel,
  createLocalTranscriptionModel,
  getLocalVoiceStatus,
  installAppleAsrAsset,
  listAppleAsrLocales
} from '../../localAdapters'

const mocks = vi.hoisted(() => ({ nativeRequest: vi.fn(), decode: vi.fn() }))

vi.mock('@cherrystudio/system-speech/native', () => ({
  SystemSpeechNativeClient: class {
    request = mocks.nativeRequest
  }
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

let directory: string
let expectedTranscriptionInput: Uint8Array
const wav = Buffer.from('UklGRiYAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQIAAAAAAA==', 'base64')

function wavWithUInt16(offset: number, value: number): Buffer {
  const changed = Buffer.from(wav)
  changed.writeUInt16LE(value, offset)
  return changed
}

function wavWithUInt32(offset: number, value: number): Buffer {
  const changed = Buffer.from(wav)
  changed.writeUInt32LE(value, offset)
  return changed
}

function wavWithTag(offset: number, value: string): Buffer {
  const changed = Buffer.from(wav)
  changed.write(value, offset, 'ascii')
  return changed
}

function wavWithEmptyData(): Buffer {
  const changed = Buffer.from(wav.subarray(0, 44))
  changed.writeUInt32LE(changed.length - 8, 4)
  changed.writeUInt32LE(0, 40)
  return changed
}

function wavWithOddMetadataChunk(): Buffer {
  const chunk = Buffer.alloc(10)
  chunk.write('JUNK', 0, 'ascii')
  chunk.writeUInt32LE(1, 4)
  chunk[8] = 0x2a
  const changed = Buffer.concat([wav.subarray(0, 36), chunk, wav.subarray(36)])
  changed.writeUInt32LE(changed.length - 8, 4)
  return changed
}
const capabilities = {
  operation: 'capabilities',
  result: {
    osVersion: '26.3',
    requestedLocale: 'en-US',
    supportedLocale: 'en_US',
    appleAssetStatus: 'installed',
    voices: [{ id: 'voice.exact', name: 'Voice', locale: 'en-US', quality: 1 }]
  }
}

beforeEach(async () => {
  mockMainLoggerService.warn.mockClear()
  directory = await mkdtemp(join(tmpdir(), 'apple-adapter-'))
  expectedTranscriptionInput = wav
  vi.stubGlobal(
    'process',
    Object.defineProperties(Object.create(process), {
      getSystemVersion: { value: () => '26.3' },
      platform: { value: 'darwin' }
    })
  )
  vi.mocked(application.getPath).mockImplementation((_key, filename) =>
    filename ? join(directory, filename) : directory
  )
  vi.mocked(application.get).mockImplementation(() => ({ client: () => ({ request: mocks.decode }) }) as never)
  mocks.decode.mockResolvedValue({ wav, durationSeconds: 1, sampleRate: 16000, channels: 1 })
  mocks.nativeRequest.mockImplementation(async (request) => {
    if (request.operation === 'capabilities') return capabilities
    if (request.operation === 'synthesize') {
      await writeFile(request.outputPath, wav)
      return {
        operation: 'synthesize',
        result: {
          voiceId: request.voiceId,
          outputPath: request.outputPath,
          sampleRate: 16000,
          channels: 1,
          frameCount: 16000
        }
      }
    }
    if (request.operation === 'transcribe') {
      expect(await readFile(request.inputPath)).toEqual(expectedTranscriptionInput)
      return { operation: 'transcribe', result: { locale: 'en_US', text: 'private transcript' } }
    }
    return { operation: 'install_asr_assets', result: { status: 'installed', locale: 'en_US' } }
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  mocks.nativeRequest.mockReset()
  mocks.decode.mockReset()
  await rm(directory, { force: true, recursive: true })
})

describe('local Apple adapters', () => {
  it.each(['transcription_failed', 'native_helper_failed', 'timeout'] as const)(
    'preserves native failure category %s without recording private error details',
    async (code) => {
      const failure = new SystemSpeechError(code)
      failure.message = '/private/recording.wav private transcript canary'
      mocks.nativeRequest.mockImplementation(async (request) => {
        if (request.operation === 'capabilities') return capabilities
        throw failure
      })
      await expect(
        createLocalTranscriptionModel(APPLE_ASR_MODEL_ID, {}).doGenerate({
          audio: new Uint8Array([1]),
          mediaType: 'audio/webm'
        })
      ).rejects.toMatchObject({ reason: code === 'timeout' ? 'timeout' : 'operation_failed' })
      expect(mockMainLoggerService.warn.mock.calls).toEqual([
        ['Apple voice operation failed', { stage: 'native', code }]
      ])
      expect(await readdir(directory)).toEqual([])
    }
  )

  it('does not report user cancellation as a native failure', async () => {
    mocks.nativeRequest.mockRejectedValue(new SystemSpeechError('cancelled'))
    await expect(listAppleAsrLocales()).rejects.toMatchObject({ reason: 'aborted' })
    expect(mockMainLoggerService.warn).not.toHaveBeenCalled()
  })

  it('uses the installed offline Apple recognizer on macOS 15', async () => {
    vi.stubGlobal(
      'process',
      Object.defineProperties(Object.create(process), {
        getSystemVersion: { value: () => '15.7' },
        platform: { value: 'darwin' }
      })
    )

    expect(await getLocalVoiceStatus(APPLE_ASR_MODEL_ID, { language: 'en-US' })).toEqual({ status: 'ready' })
    const result = await createLocalTranscriptionModel(APPLE_ASR_MODEL_ID, { language: 'en-US' }).doGenerate({
      audio: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      mediaType: 'audio/webm;codecs=opus'
    })
    expect(result.text).toBe('private transcript')
    expect(await readdir(directory)).toEqual([])
  })

  it('lists recognition locales reported by the native helper', async () => {
    mocks.nativeRequest.mockResolvedValueOnce({
      operation: 'list_asr_locales',
      result: { supported: ['en-US', 'zh-CN'], installed: ['en-US'] }
    })
    await expect(listAppleAsrLocales()).resolves.toEqual({ supported: ['en-US', 'zh-CN'], installed: ['en-US'] })
    expect(mocks.nativeRequest).toHaveBeenCalledWith({ operation: 'list_asr_locales' }, { signal: undefined })
  })

  it('does not install an Apple recognition asset on macOS 15', async () => {
    vi.stubGlobal(
      'process',
      Object.defineProperties(Object.create(process), {
        getSystemVersion: { value: () => '15.7' },
        platform: { value: 'darwin' }
      })
    )
    await expect(installAppleAsrAsset('en-US')).rejects.toMatchObject({ reason: 'unsupported' })
    expect(mocks.nativeRequest).not.toHaveBeenCalled()
  })

  it('returns WAV bytes and releases synthesis scratch before completion', async () => {
    const model = createLocalSpeechModel(APPLE_TTS_MODEL_ID, { voice: 'voice.exact' })
    const result = await model.doGenerate({ text: 'private TTS text', voice: 'voice.exact', outputFormat: 'wav' })
    expect(result.audio).toEqual(new Uint8Array(wav))
    expect(await readdir(directory)).toEqual([])
    expect(result.response.body).toBeUndefined()
  })

  it('rejects a missing exact voice without creating output', async () => {
    await expect(
      createLocalSpeechModel(APPLE_TTS_MODEL_ID, { voice: 'missing' }).doGenerate({ text: 'private' })
    ).rejects.toMatchObject({ reason: 'voice_unavailable' })
    expect(await readdir(directory)).toEqual([])
  })

  it('accepts WebM through the private decoder and removes derived WAV', async () => {
    const result = await createLocalTranscriptionModel(APPLE_ASR_MODEL_ID, { language: 'en-US' }).doGenerate({
      audio: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      mediaType: 'audio/webm;codecs=opus'
    })
    expect(result.text).toBe('private transcript')
    expect(result.durationInSeconds).toBe(1)
    expect(await readdir(directory)).toEqual([])
  })

  it.each([
    ['canonical header', wav],
    ['odd-sized metadata chunk', wavWithOddMetadataChunk()]
  ])('accepts WAV with a %s without invoking the WebM decoder', async (_description, audio) => {
    expectedTranscriptionInput = audio
    const result = await createLocalTranscriptionModel(APPLE_ASR_MODEL_ID, { language: 'en-US' }).doGenerate({
      audio,
      mediaType: 'audio/wav'
    })
    expect(result.text).toBe('private transcript')
    expect(result.durationInSeconds).toBe(1 / 16000)
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])
  })

  it.each([
    ['non-PCM encoding', wavWithUInt16(20, 3)],
    ['stereo channels', wavWithUInt16(22, 2)],
    ['non-16 kHz sample rate', wavWithUInt32(24, 48000)],
    ['inconsistent byte rate', wavWithUInt32(28, 64000)],
    ['inconsistent block alignment', wavWithUInt16(32, 4)],
    ['non-16-bit samples', wavWithUInt16(34, 24)],
    ['truncated header', wav.subarray(0, 30)],
    ['inconsistent RIFF size', wavWithUInt32(4, wav.length - 9)],
    ['out-of-bounds fmt chunk', wavWithUInt32(16, wav.length)],
    ['out-of-bounds data chunk', wavWithUInt32(40, 4)],
    ['missing fmt chunk', wavWithTag(12, 'JUNK')],
    ['missing data chunk', wavWithTag(36, 'JUNK')],
    ['empty data chunk', wavWithEmptyData()],
    ['data not aligned to a sample', wavWithUInt32(40, 1)]
  ])('rejects canonical WAV with %s', async (_description, audio) => {
    await expect(
      createLocalTranscriptionModel(APPLE_ASR_MODEL_ID, {}).doGenerate({ audio, mediaType: 'audio/wav' })
    ).rejects.toMatchObject({ reason: 'invalid_audio' })
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(mocks.nativeRequest).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])
  })

  it('aborts native WAV transcription and removes the scratch input', async () => {
    const controller = new AbortController()
    mocks.nativeRequest.mockImplementation(async (request, options) => {
      if (request.operation === 'capabilities') return capabilities
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason))
      })
    })
    const outcome = Promise.resolve(
      createLocalTranscriptionModel(APPLE_ASR_MODEL_ID, {}).doGenerate({
        audio: wav,
        mediaType: 'audio/wav',
        abortSignal: controller.signal
      })
    ).catch((error: unknown) => error)
    await vi.waitFor(() =>
      expect(mocks.nativeRequest.mock.calls.some(([request]) => request.operation === 'transcribe')).toBe(true)
    )
    controller.abort()
    expect(await outcome).toMatchObject({ reason: 'aborted' })
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])
  })

  it('sanitizes native WAV failures and removes the scratch input', async () => {
    const failure = new SystemSpeechError('transcription_failed')
    failure.message = '/private/recording.wav private transcript canary'
    mocks.nativeRequest.mockImplementation(async (request) => {
      if (request.operation === 'capabilities') return capabilities
      throw failure
    })
    const error = await Promise.resolve(
      createLocalTranscriptionModel(APPLE_ASR_MODEL_ID, {}).doGenerate({ audio: wav, mediaType: 'audio/wav' })
    ).catch((error: unknown) => error)
    expect(error).toMatchObject({ reason: 'operation_failed', message: 'operation_failed' })
    expect((error as Error).cause).toBeUndefined()
    expect(mockMainLoggerService.warn.mock.calls).toEqual([
      ['Apple voice operation failed', { stage: 'native', code: 'transcription_failed' }]
    ])
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])
  })

  it('maps malformed WebM to invalid_audio without retaining derived files', async () => {
    mocks.decode.mockRejectedValue(
      new UtilityProcessError('PROCESS_REMOTE_ERROR', 'invalid audio', {
        processId: 'voice.audio',
        remote: { name: 'Error', message: 'invalid audio', code: 'VOICE_AUDIO_INVALID' }
      })
    )
    await expect(
      createLocalTranscriptionModel(APPLE_ASR_MODEL_ID, {}).doGenerate({
        audio: new Uint8Array([1]),
        mediaType: 'audio/webm'
      })
    ).rejects.toMatchObject({ reason: 'invalid_audio' })
    expect(mockMainLoggerService.warn.mock.calls).toEqual([
      ['Apple voice operation failed', { stage: 'decode', code: 'VOICE_AUDIO_INVALID' }]
    ])
    expect(await readdir(directory)).toEqual([])
  })

  it('bounds isolated decoder work and cleans scratch after timeout termination', async () => {
    const timeout = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    mocks.decode.mockImplementation(
      (_method, _input, { signal }) =>
        new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
    )
    const outcome = Promise.resolve(
      createLocalTranscriptionModel(APPLE_ASR_MODEL_ID, {}).doGenerate({
        audio: new Uint8Array([1]),
        mediaType: 'audio/webm'
      })
    ).catch((error: unknown) => error)
    await vi.waitFor(() => expect(mocks.decode.mock.calls.length).toBe(1))
    timeout.abort(new DOMException('Decoder timeout', 'TimeoutError'))
    expect(await outcome).toMatchObject({ reason: 'timeout' })
    expect(await readdir(directory)).toEqual([])
  })

  it('reports asset_required without implicit installation or fallback', async () => {
    mocks.nativeRequest.mockResolvedValue({
      ...capabilities,
      result: { ...capabilities.result, appleAssetStatus: 'supported' }
    })
    expect(await getLocalVoiceStatus(APPLE_ASR_MODEL_ID, { language: 'en-US' })).toEqual({
      status: 'not_installed',
      reason: 'asset_required'
    })
    await expect(
      createLocalTranscriptionModel(APPLE_ASR_MODEL_ID, {}).doGenerate({
        audio: new Uint8Array([1]),
        mediaType: 'audio/webm;codecs=opus'
      })
    ).rejects.toMatchObject({ reason: 'asset_required' })
    expect(mocks.nativeRequest.mock.calls.every(([request]) => request.operation === 'capabilities')).toBe(true)
  })

  it('fails explicit FunASR selection closed before probing Apple', () => {
    expect(() => createLocalTranscriptionModel(FUNASR_MODEL_ID, {})).toThrow('license_unverified')
    expect(mocks.nativeRequest.mock.calls).toEqual([])
  })

  it('rejects an unknown model instead of treating it as Apple TTS', async () => {
    await expect(getLocalVoiceStatus('unknown' as typeof APPLE_ASR_MODEL_ID)).rejects.toMatchObject({
      reason: 'unsupported'
    })
  })

  it('exposes installation only through its explicit operation', async () => {
    expect(await installAppleAsrAsset('en-US')).toEqual({ status: 'installed', locale: 'en_US' })
    expect(mocks.nativeRequest.mock.calls[0]?.[0]).toEqual({
      operation: 'install_asr_assets',
      locale: 'en-US',
      confirmDownload: true
    })
  })

  it('cleans partially written output and sanitizes an engine failure', async () => {
    mocks.nativeRequest.mockImplementation(async (request) => {
      if (request.operation === 'capabilities') return capabilities
      await writeFile(request.outputPath, wav)
      throw new Error('/private/path private TTS text')
    })
    const error = await Promise.resolve(
      createLocalSpeechModel(APPLE_TTS_MODEL_ID, { voice: 'voice.exact' }).doGenerate({ text: 'private TTS text' })
    ).catch((error: unknown) => error)
    expect(error).toMatchObject({ reason: 'operation_failed', message: 'operation_failed' })
    expect((error as Error).cause).toBeUndefined()
    expect(await readdir(directory)).toEqual([])
  })
})
