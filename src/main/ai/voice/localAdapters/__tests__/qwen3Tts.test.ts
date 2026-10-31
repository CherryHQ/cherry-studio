import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { QWEN3_TTS_BUNDLE_ID, VoiceModelSupport } from '@shared/ai/localVoice'

import { mlxVoiceSupport } from '../../voicePlatform'
import { createQwen3SpeechModel } from '../qwen3Tts'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const synthesize = vi.fn()
let directory: string
const wav = Buffer.from('UklGRiYAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQIAAAAAAA==', 'base64')

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'qwen-tts-adapter-'))
  vi.mocked(application.getPath).mockImplementation((_key, filename) =>
    filename ? join(directory, filename) : directory
  )
  vi.mocked(application.get).mockImplementation(((name: string) => {
    if (name === 'TtsInferenceService') return { synthesize }
    if (name === 'LocalModelService') return { refreshStatus: () => ({ status: 'ready' }) }
    throw new Error(`Unexpected service ${name}`)
  }) as never)
})

afterEach(async () => {
  synthesize.mockReset()
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

describe('Qwen3-TTS adapter', () => {
  it('synthesizes the selected bundle, voice and language and removes private output after reading', async () => {
    synthesize.mockImplementation(async (modelId, input) => {
      expect(modelId).toBe(QWEN3_TTS_BUNDLE_ID)
      expect(input).toMatchObject({ text: 'Hello', voice: 'vivian', language: 'english', speed: 1.25 })
      await writeFile(input.outputPath, wav)
    })
    const result = await createQwen3SpeechModel({ voice: 'vivian', language: 'en-US', speed: 1.25 }).doGenerate({
      text: 'Hello'
    })
    expect(result.audio).toEqual(new Uint8Array(wav))
    expect(await readdir(directory)).toEqual([])
  })

  it('waits for cancelled inference to settle before removing scratch and returning', async () => {
    const controller = new AbortController()
    const started = Promise.withResolvers<void>()
    const settled = Promise.withResolvers<void>()
    synthesize.mockImplementation(async (_id, _input, signal: AbortSignal) => {
      started.resolve()
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
      await settled.promise
      signal.throwIfAborted()
    })
    let finished = false
    const result = Promise.resolve(
      createQwen3SpeechModel({ voice: 'vivian', language: 'en-US' }).doGenerate({
        text: 'Hello',
        abortSignal: controller.signal
      })
    ).catch((error) => {
      finished = true
      return error
    })
    await started.promise
    controller.abort()
    await Promise.resolve()
    expect(finished).toBe(false)
    settled.resolve()
    expect(await result).toMatchObject({ reason: 'aborted' })
    expect(await readdir(directory)).toEqual([])
  })

  it.each([
    { voice: 'missing', language: 'en-US' },
    { voice: 'vivian', language: 'ar-SA' }
  ])('rejects unsupported selection %j', async (options) => {
    await expect(createQwen3SpeechModel(options).doGenerate({ text: 'Hello' })).rejects.toMatchObject({
      reason: 'invalid_request'
    })
    expect(await readdir(directory)).toEqual([])
  })

  it('offers the runtime only on supported Apple Silicon systems', () => {
    expect(mlxVoiceSupport({ platform: 'darwin', arch: 'arm64', majorVersion: 26, minorVersion: 2 })).toBe(
      VoiceModelSupport.Supported
    )
    expect(mlxVoiceSupport({ platform: 'darwin', arch: 'arm64', majorVersion: 26, minorVersion: 1 })).toBe(
      VoiceModelSupport.UnsupportedVersion
    )
    expect(mlxVoiceSupport({ platform: 'darwin', arch: 'x64', majorVersion: 26, minorVersion: 2 })).toBe(
      VoiceModelSupport.UnsupportedArchitecture
    )
    expect(mlxVoiceSupport({ platform: 'win32', arch: 'x64' })).toBe(VoiceModelSupport.UnsupportedPlatform)
  })
})
