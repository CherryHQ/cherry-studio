import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it, vi } from 'vitest'

import { createRecordingLogger, rejectionOf } from '@main/core/utilityProcess/__tests__/hostTestUtils'
import {
  createMemoryProcessAdapter,
  flushMicrotasks,
  waitUntil
} from '@main/core/utilityProcess/__tests__/memoryProcessAdapter'
import { ProcessHost } from '@main/core/utilityProcess/host/ProcessHost'

import { decodeWebm } from '../decodeWebm'
import type { decodeVoiceAudio } from '../utilityEntries/voiceAudio'
import { type VoiceAudioContract, voiceAudioProcess } from '../voiceAudioProcess'

vi.mock('@main/core/utilityProcess/runtime/serveUtilityProcess', () => ({ serveUtilityProcess: vi.fn() }))

const input = {
  audio: new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/media-recorder-opus.webm', import.meta.url)))),
  mimeType: 'audio/webm;codecs=opus'
}

describe('Voice audio utility process ownership', () => {
  it('holds a cancellation until the decoder process exits, then decodes in a fresh generation', async () => {
    let started = false
    const adapter = createMemoryProcessAdapter((child, generation) => {
      child.serve<VoiceAudioContract>({
        id: 'voice.audio',
        handlers: {
          decode: (audio, { signal }) => {
            started = true
            if (generation === 0) return new Promise(() => {})
            return decodeWebm(audio, signal)
          }
        }
      })
      if (generation === 0) child.onKill(() => {})
    })
    const logger = createRecordingLogger()
    const host = new ProcessHost(voiceAudioProcess, {
      adapter,
      logger,
      resolveEntry: () => '/voice-audio.js',
      getTempDir: () => '/tmp/cherry-voice-test'
    })
    const controller = new AbortController()
    const reason = new Error('cancel decoding')
    let settled = false
    const pending = host.request('decode', input, { signal: controller.signal })
    void pending.catch(() => {
      settled = true
    })
    await waitUntil(() => started, 'decoder started')
    controller.abort(reason)
    await flushMicrotasks()
    expect(settled).toBe(false)
    expect(adapter.spawns[0].child.killed).toBe(true)
    adapter.spawns[0].child.exit(143)
    expect(await rejectionOf(pending)).toBe(reason)
    try {
      const result = await host.request('decode', input)
      expect(result).toMatchObject({ sampleRate: 16_000, channels: 1, durationSeconds: 0.96 })
      expect(adapter.spawns).toHaveLength(2)
      expect(logger.entries.filter((entry) => entry.level === 'error')).toEqual([])
    } finally {
      await host.stop()
    }
  })
})

describe('production Voice audio MIME dispatch', () => {
  let decode: typeof decodeVoiceAudio
  beforeAll(async () => {
    const { serveUtilityProcess } = await import('@main/core/utilityProcess/runtime/serveUtilityProcess')
    await import('../utilityEntries/voiceAudio')
    const options = vi.mocked(serveUtilityProcess<VoiceAudioContract>).mock.calls[0][0]
    const handler = options.handlers.decode
    decode = async (input) =>
      handler(input, {
        signal: new AbortController().signal,
        emit: () => {},
        callHost: async () => undefined,
        logger: createRecordingLogger()
      })
  })
  it.each([
    ['media-recorder-opus.webm', 'audio/webm;codecs=opus'],
    ['media-recorder-opus.webm', ' Audio/WebM ; CODECS = OPUS '],
    ['media-recorder-opus.ogg', 'audio/ogg'],
    ['media-recorder-opus.ogg', ' Audio/OGG ; codecs = Opus '],
    ['media-recorder-opus.ogg', 'audio/ogg; codecs="opus"']
  ])('decodes %s through the registered production handler with MIME %s', async (file, mimeType) => {
    const audio = new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url))))
    const result = await decode({ audio, mimeType })
    expect(result).toMatchObject({ sampleRate: 16000, channels: 1, durationSeconds: 0.96 })
  })

  it.each(['audio/wav', 'audio/webm', 'audio/ogg;codecs=vorbis', 'application/ogg'])(
    'retains the existing unsupported-MIME rejection for %s',
    async (mimeType) => {
      const { decodeVoiceAudio } = await import('../utilityEntries/voiceAudio')
      await expect(decodeVoiceAudio({ ...input, mimeType })).rejects.toMatchObject({ code: 'VOICE_AUDIO_UNSUPPORTED' })
    }
  )
})
