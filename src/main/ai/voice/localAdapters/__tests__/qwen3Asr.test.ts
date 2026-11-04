import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { AsrInferenceService } from '@main/ai/localModel'
import { UtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'
import { QWEN3_ASR_BUNDLE_ID } from '@shared/ai/localVoice'

import { createQwen3AsrTranscriptionModel } from '../qwen3Asr'

const mocks = vi.hoisted(() => ({
  transcribe: vi.fn<AsrInferenceService['transcribe']>(),
  refreshStatus: vi.fn(),
  decode: vi.fn()
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

function wav(): Uint8Array {
  const buffer = Buffer.alloc(64)
  const audio = buffer.subarray(16)
  audio.write('RIFF')
  audio.writeUInt32LE(40, 4)
  audio.write('WAVEfmt ', 8)
  audio.writeUInt32LE(16, 16)
  audio.writeUInt16LE(1, 20)
  audio.writeUInt16LE(1, 22)
  audio.writeUInt32LE(16000, 24)
  audio.writeUInt32LE(32000, 28)
  audio.writeUInt16LE(2, 32)
  audio.writeUInt16LE(16, 34)
  audio.write('data', 36)
  audio.writeUInt32LE(4, 40)
  audio.writeInt16LE(-32768, 44)
  audio.writeInt16LE(16384, 46)
  return audio
}

beforeEach(() => {
  vi.mocked(application.get).mockImplementation(((name: string) => {
    if (name === 'LocalModelService') return { refreshStatus: mocks.refreshStatus }
    if (name === 'AsrInferenceService') return { transcribe: mocks.transcribe }
    return { client: () => ({ request: mocks.decode }) }
  }) as never)
  mocks.refreshStatus.mockReturnValue({ status: 'ready' })
  mocks.transcribe.mockImplementation(async (id, source) => {
    if (id !== QWEN3_ASR_BUNDLE_ID || source.kind !== 'samples') throw new Error('Wrong model or transport')
    expect(source.sampleRate).toBe(16000)
    expect([...source.samples]).toEqual([-1, 0.5])
    return { text: '明天开会', segments: [] }
  })
  mocks.decode.mockResolvedValue({ wav: wav(), durationSeconds: 2 / 16000, sampleRate: 16000, channels: 1 })
})
afterEach(() => vi.resetAllMocks())

const generate = (audio = wav(), mediaType = 'audio/wav', abortSignal?: AbortSignal) =>
  createQwen3AsrTranscriptionModel({}).doGenerate({ audio, mediaType, abortSignal })

describe('Qwen3 ASR adapter', () => {
  it('preserves PCM values from a sliced WAV and returns final text without invented timing', async () => {
    await expect(generate()).resolves.toMatchObject({ text: '明天开会', segments: [], durationInSeconds: 2 / 16000 })
  })
  it('decodes recorder WebM before sending PCM to the selected ASR model', async () => {
    await expect(generate(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), 'audio/webm;codecs=opus')).resolves.toMatchObject({
      text: '明天开会'
    })
  })
  it('rejects missing resources before inference', async () => {
    mocks.refreshStatus.mockReturnValue({ status: 'not_downloaded' })
    await expect(generate()).rejects.toMatchObject({ reason: 'model_required' })
  })
  it('does not return a stale transcript after cancellation', async () => {
    const controller = new AbortController()
    mocks.transcribe.mockImplementation(async () => {
      controller.abort()
      return { text: 'late result', segments: [] }
    })
    await expect(generate(wav(), 'audio/wav', controller.signal)).rejects.toMatchObject({ reason: 'aborted' })
  })
  it('maps a native load failure without exposing filesystem details', async () => {
    mocks.transcribe.mockRejectedValue(
      new UtilityProcessError('PROCESS_REMOTE_ERROR', 'private', {
        processId: 'inference:asr',
        remote: { name: 'Error', message: '/private/model', code: 'ASR_MODEL_LOAD_FAILED' }
      })
    )
    await expect(generate()).rejects.toMatchObject({ reason: 'model_load_failed', message: 'model_load_failed' })
  })
  it('rejects malformed audio and explicit language overrides', async () => {
    await expect(generate(new Uint8Array([1]))).rejects.toMatchObject({ reason: 'invalid_audio' })
    await expect(
      createQwen3AsrTranscriptionModel({ language: 'en' }).doGenerate({ audio: wav(), mediaType: 'audio/wav' })
    ).rejects.toMatchObject({ reason: 'invalid_request' })
  })
})
