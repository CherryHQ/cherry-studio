import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { SystemSpeechError } from '@cherrystudio/system-speech/contracts'
import { APPLE_TTS_MODEL_ID, WINDOWS_TTS_MODEL_ID } from '@shared/ai/localVoice'

import { createLocalSpeechModel, getLocalVoiceStatus, listLocalVoices } from '../../localAdapters'

const mocks = vi.hoisted(() => ({ nativeRequest: vi.fn() }))
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

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  mocks.nativeRequest.mockReset()
  await rm(directory, { recursive: true, force: true })
})

describe('Windows system TTS adapter', () => {
  it('lists installed SAPI voices and is ready even when ASR is unsupported', async () => {
    expect(await listLocalVoices()).toEqual(voices)
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
