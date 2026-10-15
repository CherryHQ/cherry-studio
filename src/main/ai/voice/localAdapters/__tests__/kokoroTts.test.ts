import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { KOKORO_TTS_BUNDLE_ID, VoiceModelSupport } from '@shared/ai/localVoice'

import { createKokoroSpeechModel, getKokoroTtsStatus, kokoroSpeechDefinition, kokoroTtsSupport } from '../kokoroTts'

const synthesize = vi.fn()
const refreshStatus = vi.fn()
let directory: string
const wav = Buffer.from('UklGRiYAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQIAAAAAAA==', 'base64')

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'kokoro-tts-adapter-'))
  vi.mocked(application.getPath).mockImplementation((_key, filename) =>
    filename ? join(directory, filename) : directory
  )
  refreshStatus.mockReturnValue({ status: 'ready' })
  vi.mocked(application.get).mockImplementation(((name: string) => {
    if (name === 'TtsInferenceService') return { synthesize }
    if (name === 'LocalModelService') return { refreshStatus }
    throw new Error(`Unexpected service ${name}`)
  }) as never)
})

afterEach(async () => {
  synthesize.mockReset()
  refreshStatus.mockReset()
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

describe('Kokoro Chinese-English speech', () => {
  it.each([
    ['zf_001', '3'],
    ['zf_055', '57'],
    ['zm_001', '58'],
    ['zm_045', '102']
  ])('preserves mixed text and maps %s to the published speaker ID %s', async (voice, sid) => {
    const text = '你好，Cherry Studio supports Windows 和 Linux。'
    synthesize.mockImplementation(async (modelId, input) => {
      expect(modelId).toBe(KOKORO_TTS_BUNDLE_ID)
      expect(input).toMatchObject({ text, voice: sid, language: 'zh-CN', speed: 1.25 })
      await writeFile(input.outputPath, wav)
    })
    const result = await createKokoroSpeechModel({ voice, language: 'zh-CN', speed: 1.25 }).doGenerate({ text })
    expect(result.audio).toEqual(new Uint8Array(wav))
    expect(await readdir(directory)).toEqual([])
  })

  it('keeps every voice available for both languages and chooses a Chinese voice for Chinese', async () => {
    const voice = await kokoroSpeechDefinition.getDefaultVoice('zh-CN')
    expect(voice?.id).toBe('zf_001')
    const voices = await kokoroSpeechDefinition.voices()
    expect(voices).toHaveLength(103)
    expect(voices.every((voice) => voice.languages?.includes('zh-CN') && voice.languages.includes('en-US'))).toBe(true)
  })

  it('checks this model download independently of other speech or recognition models', () => {
    refreshStatus.mockImplementation((id) => ({ status: id === KOKORO_TTS_BUNDLE_ID ? 'not_downloaded' : 'ready' }))
    expect(getKokoroTtsStatus()).toEqual({ status: 'not_installed', reason: 'model_required' })
  })

  it.each([
    { voice: 'missing', language: 'zh-CN' },
    { voice: 'zf_001', language: 'ja-JP' }
  ])('rejects unsupported voice or language %j before inference', async (options) => {
    await expect(createKokoroSpeechModel(options).doGenerate({ text: '你好' })).rejects.toMatchObject({
      reason: 'invalid_request'
    })
    expect(await readdir(directory)).toEqual([])
  })

  it('settles cancelled inference before deleting its private output', async () => {
    const controller = new AbortController()
    const started = Promise.withResolvers<void>()
    const settled = Promise.withResolvers<void>()
    synthesize.mockImplementation(async (_modelId, _input, signal: AbortSignal) => {
      started.resolve()
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
      await settled.promise
      signal.throwIfAborted()
    })
    const result = Promise.resolve(
      createKokoroSpeechModel({ voice: 'zf_001' }).doGenerate({ text: '你好 Hello', abortSignal: controller.signal })
    ).catch((error) => error)
    await started.promise
    controller.abort()
    expect((await readdir(directory)).length).toBe(1)
    settled.resolve()
    expect(await result).toMatchObject({ reason: 'aborted' })
    expect(await readdir(directory)).toEqual([])
  })

  it('supports desktop Sherpa targets and excludes unavailable Windows ARM64 binaries', () => {
    for (const [platform, arch] of [
      ['win32', 'x64'],
      ['linux', 'x64'],
      ['linux', 'arm64'],
      ['darwin', 'x64'],
      ['darwin', 'arm64']
    ]) {
      expect(kokoroTtsSupport({ platform, arch })).toBe(VoiceModelSupport.Supported)
    }
    expect(kokoroTtsSupport({ platform: 'win32', arch: 'arm64' })).toBe(VoiceModelSupport.UnsupportedArchitecture)
  })
})
