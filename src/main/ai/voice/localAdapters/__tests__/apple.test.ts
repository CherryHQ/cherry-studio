import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { UtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'
import { APPLE_ASR_MODEL_ID, APPLE_TTS_MODEL_ID } from '@shared/ai/localVoice'

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
const wav = Buffer.from('UklGRiYAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQIAAAAAAA==', 'base64')
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

function stubMacVersion(version: string): void {
  vi.stubGlobal(
    'process',
    Object.defineProperties(Object.create(process), {
      getSystemVersion: { value: () => version },
      platform: { value: 'darwin' }
    })
  )
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'apple-adapter-'))
  stubMacVersion('26.3')
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
      expect(await readFile(request.inputPath)).toEqual(wav)
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
  it('uses the installed offline Apple recognizer on macOS 15 without requesting an asset', async () => {
    stubMacVersion('15.7')
    mocks.nativeRequest.mockResolvedValueOnce({
      ...capabilities,
      result: { ...capabilities.result, osVersion: '15.7' }
    })
    expect(await getLocalVoiceStatus(APPLE_ASR_MODEL_ID, { language: 'en-US' })).toEqual({ status: 'ready' })

    mocks.nativeRequest
      .mockResolvedValueOnce({ ...capabilities, result: { ...capabilities.result, osVersion: '15.7' } })
      .mockResolvedValueOnce({ operation: 'transcribe', result: { locale: 'en_US', text: 'offline transcript' } })
    const result = await createLocalTranscriptionModel(APPLE_ASR_MODEL_ID, { language: 'en-US' }).doGenerate({
      audio: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      mediaType: 'audio/webm;codecs=opus'
    })
    expect(result.text).toBe('offline transcript')
    expect(await readdir(directory)).toEqual([])
  })

  it('does not offer asset installation on macOS 15', async () => {
    stubMacVersion('15.7')
    await expect(installAppleAsrAsset('en-US')).rejects.toMatchObject({ reason: 'unsupported' })
    expect(mocks.nativeRequest).not.toHaveBeenCalled()
  })

  it('lists only system-supported Apple recognition locales', async () => {
    mocks.nativeRequest.mockResolvedValueOnce({
      operation: 'list_asr_locales',
      result: { supported: ['en-US', 'zh-CN'], installed: ['en-US'] }
    })

    await expect(listAppleAsrLocales()).resolves.toEqual({ supported: ['en-US', 'zh-CN'], installed: ['en-US'] })
    expect(mocks.nativeRequest).toHaveBeenCalledWith({ operation: 'list_asr_locales' }, { signal: undefined })
  })
  it('returns WAV bytes and releases synthesis scratch before completion', async () => {
    const model = createLocalSpeechModel(APPLE_TTS_MODEL_ID, { voice: 'voice.exact' })
    const result = await model.doGenerate({ text: 'private TTS text', voice: 'voice.exact', outputFormat: 'wav' })
    expect(result.audio).toEqual(new Uint8Array(wav))
    expect(await readdir(directory)).toEqual([])
    expect(result.response.body).toBeUndefined()
  })

  it.each([
    { requestedSpeed: undefined, expectedSpeed: 1 },
    { requestedSpeed: 0.5, expectedSpeed: 0.5 },
    { requestedSpeed: 1, expectedSpeed: 1 },
    { requestedSpeed: 1.25, expectedSpeed: 1.25 },
    { requestedSpeed: 2, expectedSpeed: 2 }
  ])('passes $expectedSpeed× speed to the native helper', async ({ requestedSpeed, expectedSpeed }) => {
    await createLocalSpeechModel(APPLE_TTS_MODEL_ID, { voice: 'voice.exact', speed: requestedSpeed }).doGenerate({
      text: 'private speed canary'
    })

    expect(mocks.nativeRequest.mock.calls.find(([request]) => request.operation === 'synthesize')?.[0]).toMatchObject({
      operation: 'synthesize',
      voiceId: 'voice.exact',
      speed: expectedSpeed
    })
  })

  it.each([0.49, 2.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects unsupported speech speed %s before native work',
    async (speed) => {
      await expect(
        createLocalSpeechModel(APPLE_TTS_MODEL_ID, { voice: 'voice.exact', speed }).doGenerate({ text: 'private' })
      ).rejects.toMatchObject({ reason: 'invalid_request' })
      expect(mocks.nativeRequest).not.toHaveBeenCalled()
    }
  )

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

  it('rejects WAV-only input despite an installed Apple asset', async () => {
    await expect(
      createLocalTranscriptionModel(APPLE_ASR_MODEL_ID, {}).doGenerate({ audio: wav, mediaType: 'audio/wav' })
    ).rejects.toMatchObject({ reason: 'invalid_audio' })
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
