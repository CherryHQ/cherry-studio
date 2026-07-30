import { afterEach, describe, expect, it, vi } from 'vitest'

import { encodePcm16Wav, getPreferredSpeechRecorderMimeType } from '../useSpeechRecorder'

describe('getPreferredSpeechRecorderMimeType', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prefers WebM Opus when the runtime supports it', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: (mediaType: string) => mediaType === 'audio/webm;codecs=opus'
    })

    expect(getPreferredSpeechRecorderMimeType()).toBe('audio/webm;codecs=opus')
  })

  it('falls back to the first supported recorder type', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: (mediaType: string) => mediaType === 'audio/mp4'
    })

    expect(getPreferredSpeechRecorderMimeType()).toBe('audio/mp4')
  })
})

describe('encodePcm16Wav', () => {
  it('encodes mono PCM samples into a WAV container', () => {
    const wav = encodePcm16Wav(new Float32Array([-1, 0, 1]), 16_000)
    const view = new DataView(wav.buffer)
    const text = new TextDecoder()

    expect(text.decode(wav.slice(0, 4))).toBe('RIFF')
    expect(text.decode(wav.slice(8, 12))).toBe('WAVE')
    expect(text.decode(wav.slice(36, 40))).toBe('data')
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(6)
    expect(view.getInt16(44, true)).toBe(-32_768)
    expect(view.getInt16(46, true)).toBe(0)
    expect(view.getInt16(48, true)).toBe(32_767)
  })
})
