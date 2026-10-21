import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { KOKORO_TTS_BUNDLE_ID, VoiceModelSupport } from '@shared/ai/localVoice'

import {
  createKokoroSpeechModel,
  getKokoroTtsStatus,
  kokoroSpeechDefinition,
  kokoroTtsSupport,
  planKokoroSpeechSegments
} from '../kokoroTts'

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

  it('declares languages per voice family instead of for every voice', async () => {
    const voices = await kokoroSpeechDefinition.voices()
    expect(voices).toHaveLength(103)

    const english = voices.filter((voice) => voice.id.startsWith('af_') || voice.id.startsWith('bf_'))
    expect(english).toHaveLength(3)
    for (const voice of english) {
      expect(voice.languages).not.toContain('zh-CN')
      expect(voice.languages).toEqual([voice.id.startsWith('af_') ? 'en-US' : 'en-GB'])
    }

    const chinese = voices.filter((voice) => voice.id.startsWith('zf_') || voice.id.startsWith('zm_'))
    expect(chinese).toHaveLength(100)
    expect(chinese.every((voice) => voice.languages?.includes('zh-CN'))).toBe(true)
  })

  it('picks the explicit preferred voice for each language', async () => {
    expect((await kokoroSpeechDefinition.getDefaultVoice('zh-CN'))?.id).toBe('zf_001')
    expect((await kokoroSpeechDefinition.getDefaultVoice('en-US'))?.id).toBe('af_maple')
    expect((await kokoroSpeechDefinition.getDefaultVoice('en-GB'))?.id).toBe('bf_vale')
  })

  it('routes whole English sentences to the English voice and keeps mixed sentences on the Chinese voice', () => {
    const text = '这是中文。This is an English sentence. 这是混合 React 句子。'
    expect(planKokoroSpeechSegments(text, 'zf_001', 'af_maple')).toEqual([
      { text: '这是中文。', voice: 'zf_001' },
      { text: 'This is an English sentence.', voice: 'af_maple' },
      { text: '这是混合 React 句子。', voice: 'zf_001' }
    ])
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

  it('supports desktop Sherpa targets and rejects unavailable architectures', () => {
    for (const [platform, arch] of [
      ['win32', 'x64'],
      ['win32', 'arm64'],
      ['linux', 'x64'],
      ['linux', 'arm64'],
      ['darwin', 'x64'],
      ['darwin', 'arm64']
    ]) {
      expect(kokoroTtsSupport({ platform, arch })).toBe(VoiceModelSupport.Supported)
    }
    expect(kokoroTtsSupport({ platform: 'win32', arch: 'ia32' })).toBe(VoiceModelSupport.UnsupportedArchitecture)
  })
})
