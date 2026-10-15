import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { SystemSpeechError } from '@cherrystudio/system-speech/contracts'
import { UtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'
import { APPLE_TTS_MODEL_ID, WINDOWS_ASR_MODEL_ID, WINDOWS_TTS_MODEL_ID } from '@shared/ai/localVoice'

import {
  createLocalSpeechModel,
  createLocalTranscriptionModel,
  getLocalVoiceStatus,
  listLocalAsrLocales,
  listLocalVoices
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

function wavWithEmptyData(): Buffer {
  const changed = Buffer.from(wav.subarray(0, 44))
  changed.writeUInt32LE(changed.length - 8, 4)
  changed.writeUInt32LE(0, 40)
  return changed
}

function offsetWavView(): Uint8Array {
  const carrier = new Uint8Array(wav.length + 6)
  carrier.set([0x11, 0x22], 0)
  carrier.set(wav, 2)
  carrier.set([0x33, 0x44, 0x55, 0x66], wav.length + 2)
  return carrier.subarray(2, 2 + wav.length)
}

const voices = [{ id: 'HKEY_LOCAL_MACHINE\\voices\\exact', name: 'SAPI voice', locale: 'zh-CN', quality: 1 }]
const capabilities = {
  operation: 'capabilities',
  result: {
    osVersion: '10.0',
    requestedLocale: 'en-US',
    supportedLocale: null,
    appleAssetStatus: 'unsupported',
    voices
  }
}

function platform(platform: string, arch = 'x64') {
  vi.stubGlobal(
    'process',
    Object.defineProperties(Object.create(process), {
      platform: { value: platform },
      arch: { value: arch },
      getSystemVersion: { value: () => '26.3' }
    })
  )
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'windows-voice-adapter-'))
  platform('win32')
  vi.mocked(application.getPath).mockImplementation((_key, filename) =>
    filename ? join(directory, filename) : directory
  )
  vi.mocked(application.get).mockImplementation(() => ({ client: () => ({ request: mocks.decode }) }) as never)
  mocks.decode.mockReset().mockResolvedValue({ wav, durationSeconds: 1, sampleRate: 16000, channels: 1 })
  mocks.nativeRequest.mockImplementation(async (request) => {
    if (request.operation === 'capabilities') return capabilities
    if (request.operation !== 'synthesize' || request.voiceId !== voices[0].id || request.speed === undefined)
      throw new SystemSpeechError('invalid_request')
    await writeFile(request.outputPath, wav)
    return {
      operation: 'synthesize',
      result: {
        outputPath: request.outputPath,
        voiceId: request.voiceId,
        sampleRate: 16000,
        channels: 1,
        frameCount: 1
      }
    }
  })
})

describe('Windows system ASR adapter', () => {
  const audio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])
  const input = { audio, mediaType: 'audio/webm;codecs=opus' }

  beforeEach(() => {
    mocks.nativeRequest.mockImplementation(async (request) => {
      if (request.operation === 'probe_asr') return { operation: 'probe_asr', result: { locale: request.locale } }
      if (request.operation === 'list_asr_locales')
        return { operation: 'list_asr_locales', result: { supported: ['zh-CN'], installed: ['zh-CN'] } }
      if (request.operation !== 'transcribe') throw new Error('Unexpected native operation')
      expect(await readFile(request.inputPath)).toEqual(wav)
      return { operation: 'transcribe', result: { text: 'private transcript', locale: request.locale } }
    })
  })

  it('probes an actual recognizer independently of installed TTS voices', async () => {
    expect(await getLocalVoiceStatus(WINDOWS_ASR_MODEL_ID, { language: 'zh-CN' })).toEqual({ status: 'ready' })
    expect(mocks.nativeRequest).toHaveBeenCalledWith({ operation: 'probe_asr', locale: 'zh-CN' }, { signal: undefined })
  })

  it('lists Windows recognition locales through the shared discovery route', async () => {
    expect(await listLocalAsrLocales(WINDOWS_ASR_MODEL_ID)).toEqual({ supported: ['zh-CN'], installed: ['zh-CN'] })
    expect(mocks.nativeRequest).toHaveBeenCalledWith({ operation: 'list_asr_locales' }, { signal: undefined })
  })

  it('decodes WebM, uses the selected locale and removes derived WAV before returning', async () => {
    const result = await createLocalTranscriptionModel(WINDOWS_ASR_MODEL_ID, { language: 'zh-CN' }).doGenerate(input)
    expect(result).toMatchObject({ text: 'private transcript', language: 'zh', durationInSeconds: 1, segments: [] })
    expect(result.response.modelId).toBe(WINDOWS_ASR_MODEL_ID)
    expect(mocks.decode).toHaveBeenCalledWith(
      'decode',
      { audio, mimeType: input.mediaType },
      { signal: expect.any(AbortSignal) }
    )
    expect(mocks.nativeRequest).toHaveBeenLastCalledWith(
      { operation: 'transcribe', locale: 'zh-CN', inputPath: expect.stringContaining('input.wav') },
      { signal: undefined }
    )
    expect(await readdir(directory)).toEqual([])
  })

  it('uses the same default language for probing and transcription', async () => {
    await createLocalTranscriptionModel(WINDOWS_ASR_MODEL_ID, {}).doGenerate(input)
    expect(mocks.nativeRequest.mock.calls.map(([request]) => request.locale)).toEqual(['en-US', 'en-US'])
  })

  it.each(['unsupported_locale', 'transcription_failed', 'native_helper_failed'] as const)(
    'does not decode or transcribe when the engine probe fails with %s',
    async (code) => {
      mocks.nativeRequest.mockRejectedValue(new SystemSpeechError(code))
      const unsupported = code === 'unsupported_locale'
      expect(await getLocalVoiceStatus(WINDOWS_ASR_MODEL_ID, { language: 'zh-CN' })).toEqual({
        status: unsupported ? 'unsupported' : 'failed',
        reason: unsupported ? 'unsupported' : 'operation_failed'
      })
      await expect(
        createLocalTranscriptionModel(WINDOWS_ASR_MODEL_ID, { language: 'zh-CN' }).doGenerate(input)
      ).rejects.toMatchObject({ reason: unsupported ? 'unsupported' : 'operation_failed' })
      expect(mocks.decode).not.toHaveBeenCalled()
      expect(mocks.nativeRequest.mock.calls.every(([request]) => request.operation === 'probe_asr')).toBe(true)
    }
  )

  it.each([
    ['win32', 'arm64'],
    ['darwin', 'arm64'],
    ['linux', 'x64']
  ])('rejects Windows ASR on %s/%s without calling a native helper', async (os, arch) => {
    platform(os, arch)
    await expect(createLocalTranscriptionModel(WINDOWS_ASR_MODEL_ID, {}).doGenerate(input)).rejects.toMatchObject({
      reason: 'unsupported'
    })
    expect(mocks.nativeRequest).not.toHaveBeenCalled()
  })

  it('rejects a non-WAV container before probing even when the bytes are canonical WAV', async () => {
    await expect(
      createLocalTranscriptionModel(WINDOWS_ASR_MODEL_ID, {}).doGenerate({ audio: wav, mediaType: 'audio/mpeg' })
    ).rejects.toMatchObject({ reason: 'invalid_audio' })
    expect(mocks.nativeRequest).not.toHaveBeenCalled()
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])
  })

  it('transcribes canonical PCM16 mono 16 kHz WAV without decoding WebM', async () => {
    const result = await createLocalTranscriptionModel(WINDOWS_ASR_MODEL_ID, { language: 'zh-CN' }).doGenerate({
      audio: wav,
      mediaType: 'audio/wav'
    })
    expect(result).toMatchObject({
      text: 'private transcript',
      language: 'zh',
      durationInSeconds: 1 / 16000,
      segments: []
    })
    expect(result.response.modelId).toBe(WINDOWS_ASR_MODEL_ID)
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(mocks.nativeRequest.mock.calls.map(([request]) => request.operation)).toEqual(['probe_asr', 'transcribe'])
    expect(await readdir(directory)).toEqual([])
  })

  it('transcribes a byte-offset canonical WAV view and forwards only those bytes', async () => {
    const audio = offsetWavView()
    expect(audio.byteOffset).not.toBe(0)
    expect(audio.byteLength).toBe(wav.length)
    const result = await createLocalTranscriptionModel(WINDOWS_ASR_MODEL_ID, { language: 'zh-CN' }).doGenerate({
      audio,
      mediaType: 'audio/wav'
    })
    expect(result).toMatchObject({ text: 'private transcript', language: 'zh', durationInSeconds: 1 / 16000 })
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])
  })

  it.each([
    ['empty bytes', new Uint8Array()],
    ['a truncated header', wav.subarray(0, 30)],
    ['an empty data chunk', wavWithEmptyData()],
    ['stereo PCM', wavWithUInt16(22, 2)],
    ['a non-16 kHz sample rate', wavWithUInt32(24, 48_000)]
  ])('rejects WAV with %s before probing or decoding', async (_description, audio) => {
    await expect(
      createLocalTranscriptionModel(WINDOWS_ASR_MODEL_ID, {}).doGenerate({ audio, mediaType: 'audio/wav' })
    ).rejects.toMatchObject({ reason: 'invalid_audio' })
    expect(mocks.nativeRequest).not.toHaveBeenCalled()
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])
  })

  it('cancels canonical WAV transcription without decoding and removes scratch', async () => {
    const controller = new AbortController()
    let started!: () => void
    const recognitionStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    mocks.nativeRequest.mockImplementation(async (request, { signal }) => {
      if (request.operation === 'probe_asr') return { operation: 'probe_asr', result: { locale: request.locale } }
      expect(await readFile(request.inputPath)).toEqual(wav)
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new SystemSpeechError('cancelled')), { once: true })
        started()
      })
    })
    const result = Promise.resolve(
      createLocalTranscriptionModel(WINDOWS_ASR_MODEL_ID, {}).doGenerate({
        audio: wav,
        mediaType: 'audio/wav',
        abortSignal: controller.signal
      })
    ).catch((error: unknown) => error)
    const startedFirst = await Promise.race([recognitionStarted.then(() => true), result.then(() => false)])
    expect(startedFirst).toBe(true)
    controller.abort()
    expect(await result).toMatchObject({ reason: 'aborted' })
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])
  })

  it('cleans canonical WAV scratch after a native timeout', async () => {
    mocks.nativeRequest.mockImplementation(async (request) => {
      if (request.operation === 'probe_asr') return { operation: 'probe_asr', result: { locale: request.locale } }
      expect(await readFile(request.inputPath)).toEqual(wav)
      throw new SystemSpeechError('timeout')
    })
    await expect(
      createLocalTranscriptionModel(WINDOWS_ASR_MODEL_ID, {}).doGenerate({ audio: wav, mediaType: 'audio/wav' })
    ).rejects.toMatchObject({ reason: 'timeout' })
    expect(mocks.decode).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])
  })

  it.each(['timeout', 'transcription_failed'] as const)('cleans derived audio after %s', async (code) => {
    mocks.nativeRequest.mockImplementation(async (request) => {
      if (request.operation === 'probe_asr') return { operation: 'probe_asr', result: { locale: request.locale } }
      expect(await readFile(request.inputPath)).toEqual(wav)
      throw new SystemSpeechError(code)
    })
    await expect(createLocalTranscriptionModel(WINDOWS_ASR_MODEL_ID, {}).doGenerate(input)).rejects.toMatchObject({
      reason: code === 'timeout' ? 'timeout' : 'operation_failed'
    })
    expect(await readdir(directory)).toEqual([])
  })

  it('rejects malformed WebM without transcribing and removes its scratch directory', async () => {
    mocks.decode.mockRejectedValue(
      new UtilityProcessError('PROCESS_REMOTE_ERROR', 'invalid audio', {
        processId: 'voice.audio',
        remote: { name: 'Error', message: 'invalid audio', code: 'VOICE_AUDIO_INVALID' }
      })
    )
    await expect(createLocalTranscriptionModel(WINDOWS_ASR_MODEL_ID, {}).doGenerate(input)).rejects.toMatchObject({
      reason: 'invalid_audio'
    })
    expect(mocks.nativeRequest.mock.calls.map(([request]) => request.operation)).toEqual(['probe_asr'])
    expect(await readdir(directory)).toEqual([])
  })

  it('waits for native cancellation before reclaiming its WAV', async () => {
    const controller = new AbortController()
    let started!: () => void
    const recognitionStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    mocks.nativeRequest.mockImplementation(async (request, { signal }) => {
      if (request.operation === 'probe_asr') return { operation: 'probe_asr', result: { locale: request.locale } }
      expect(await readFile(request.inputPath)).toEqual(wav)
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new SystemSpeechError('cancelled')), { once: true })
        started()
      })
    })
    const result = Promise.resolve(
      createLocalTranscriptionModel(WINDOWS_ASR_MODEL_ID, {}).doGenerate({
        ...input,
        abortSignal: controller.signal
      })
    ).catch((error: unknown) => error)
    await recognitionStarted
    controller.abort()
    expect(await result).toMatchObject({ reason: 'aborted' })
    expect(await readdir(directory)).toEqual([])
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  mocks.nativeRequest.mockReset()
  await rm(directory, { recursive: true, force: true })
})

describe('Windows system TTS adapter', () => {
  it('lists installed SAPI voices and is ready even when ASR is unsupported', async () => {
    expect(await listLocalVoices(WINDOWS_TTS_MODEL_ID)).toEqual(voices)
    expect(await getLocalVoiceStatus(WINDOWS_TTS_MODEL_ID, { voice: voices[0].id, language: 'zh-CN' })).toEqual({
      status: 'ready'
    })
  })

  it('returns WAV bytes from the selected voice and removes scratch before completion', async () => {
    const result = await createLocalSpeechModel(WINDOWS_TTS_MODEL_ID, {
      voice: voices[0].id,
      language: 'zh-CN',
      speed: 1.5
    }).doGenerate({ text: 'private text', outputFormat: 'wav' })
    expect(result.audio).toEqual(new Uint8Array(wav))
    expect(result.response.modelId).toBe(WINDOWS_TTS_MODEL_ID)
    expect(await readdir(directory)).toEqual([])
  })

  it.each([{ voice: 'missing' }, { voice: voices[0].id, language: 'en-US' }])(
    'does not substitute another voice for %j',
    async (options) => {
      expect(await getLocalVoiceStatus(WINDOWS_TTS_MODEL_ID, options)).toEqual({
        status: 'not_installed',
        reason: 'voice_unavailable'
      })
      await expect(
        createLocalSpeechModel(WINDOWS_TTS_MODEL_ID, options).doGenerate({ text: 'private' })
      ).rejects.toMatchObject({ reason: 'voice_unavailable' })
      expect(await readdir(directory)).toEqual([])
    }
  )

  it('reports missing installed voices independently of ASR status', async () => {
    mocks.nativeRequest.mockResolvedValue({
      ...capabilities,
      result: { ...capabilities.result, appleAssetStatus: 'installed', voices: [] }
    })
    expect(await getLocalVoiceStatus(WINDOWS_TTS_MODEL_ID)).toEqual({
      status: 'not_installed',
      reason: 'voice_unavailable'
    })
  })

  it.each([
    ['win32', 'arm64'],
    ['darwin', 'arm64'],
    ['linux', 'x64']
  ])('rejects the explicit Windows model on %s/%s', async (os, arch) => {
    platform(os, arch)
    expect(await getLocalVoiceStatus(WINDOWS_TTS_MODEL_ID)).toEqual({ status: 'unsupported', reason: 'unsupported' })
    await expect(
      createLocalSpeechModel(WINDOWS_TTS_MODEL_ID, { voice: voices[0].id }).doGenerate({ text: 'private' })
    ).rejects.toMatchObject({ reason: 'unsupported' })
  })

  it('rejects the explicit Apple model on Windows without fallback', async () => {
    await expect(
      createLocalSpeechModel(APPLE_TTS_MODEL_ID, { voice: voices[0].id }).doGenerate({ text: 'private' })
    ).rejects.toMatchObject({ reason: 'unsupported' })
  })

  it('cleans partially written synthesis output when its owner cancels', async () => {
    let started!: () => void
    const synthesisStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    mocks.nativeRequest.mockImplementation(async (request, { signal }) => {
      if (request.operation === 'capabilities') return capabilities
      await writeFile(request.outputPath, wav)
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new SystemSpeechError('cancelled')), { once: true })
        started()
      })
    })
    const controller = new AbortController()
    const result = Promise.resolve(
      createLocalSpeechModel(WINDOWS_TTS_MODEL_ID, { voice: voices[0].id }).doGenerate({
        text: 'private',
        abortSignal: controller.signal
      })
    ).catch((error: unknown) => error)
    await synthesisStarted
    controller.abort()
    expect(await result).toMatchObject({ reason: 'aborted' })
    expect(await readdir(directory)).toEqual([])
  })

  it('sanitizes native failure and deletes partial output', async () => {
    mocks.nativeRequest.mockImplementation(async (request) => {
      if (request.operation === 'capabilities') return capabilities
      await writeFile(request.outputPath, wav)
      throw new Error('private transcript ' + directory)
    })
    const error = await Promise.resolve(
      createLocalSpeechModel(WINDOWS_TTS_MODEL_ID, { voice: voices[0].id }).doGenerate({ text: 'private' })
    ).catch((error: unknown) => error)
    expect(error).toMatchObject({ reason: 'operation_failed', message: 'operation_failed' })
    expect((error as Error).cause).toBeUndefined()
    expect(await readdir(directory)).toEqual([])
  })
})
