import { describe, expect, it, vi } from 'vitest'

import { webmOpusToWav } from '../src/webmToWav'

function fakeAudioContext(input: {
  channels?: Float32Array[]
  sampleRate?: number
  decodeError?: Error
}): AudioContext {
  const channels = input.channels ?? [new Float32Array(48_000)]
  return {
    close: vi.fn().mockResolvedValue(undefined),
    decodeAudioData: vi.fn(async () => {
      if (input.decodeError) throw input.decodeError
      return {
        duration: channels[0].length / (input.sampleRate ?? 48_000),
        getChannelData: (index: number) => channels[index],
        length: channels[0].length,
        numberOfChannels: channels.length,
        sampleRate: input.sampleRate ?? 48_000
      } as AudioBuffer
    })
  } as unknown as AudioContext
}

describe('webmOpusToWav', () => {
  it('rejects a non-WebM recording before creating an AudioContext', async () => {
    const createAudioContext = vi.fn()

    await expect(
      webmOpusToWav(new Blob([new Uint8Array([1])], { type: 'audio/ogg' }), { createAudioContext })
    ).rejects.toMatchObject({ code: 'unsupported_recording_format' })
    expect(createAudioContext).not.toHaveBeenCalled()
  })

  it('decodes, downmixes, and resamples to a mono 16 kHz WAV', async () => {
    const context = fakeAudioContext({
      channels: [new Float32Array(48_000).fill(1), new Float32Array(48_000).fill(0)],
      sampleRate: 48_000
    })

    const result = await webmOpusToWav(new Blob([new Uint8Array([1])], { type: 'audio/webm;codecs=opus' }), {
      createAudioContext: () => context,
      targetSampleRate: 16_000
    })

    expect(result.sampleRate).toBe(16_000)
    expect(result.channels).toBe(1)
    expect(result.durationSeconds).toBe(1)
    expect(new TextDecoder().decode(result.wav.subarray(0, 4))).toBe('RIFF')
    expect(new DataView(result.wav.buffer).getInt16(44, true)).toBe(16_384)
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('normalizes Chromium decode failures and closes the context', async () => {
    const context = fakeAudioContext({ decodeError: new Error('codec internals') })

    await expect(
      webmOpusToWav(new Blob([new Uint8Array([1])], { type: 'audio/webm' }), {
        createAudioContext: () => context
      })
    ).rejects.toMatchObject({ code: 'audio_decode_failed', message: 'audio_decode_failed' })
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('reports cancellation without reclassifying it as a decode failure', async () => {
    const context = fakeAudioContext({})
    const controller = new AbortController()
    controller.abort()

    await expect(
      webmOpusToWav(new Blob([new Uint8Array([1])], { type: 'audio/webm' }), {
        createAudioContext: () => context,
        signal: controller.signal
      })
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(context.close).toHaveBeenCalledOnce()
  })
})
