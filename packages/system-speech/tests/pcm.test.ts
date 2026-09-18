import { describe, expect, it } from 'vitest'

import { downmixToMono, encodePcm16Wav, resampleLinear } from '../src/pcm'

describe('PCM conversion', () => {
  it('averages channels and clamps the result', () => {
    expect([...downmixToMono([new Float32Array([1, -1]), new Float32Array([0.5, -1])])]).toEqual([0.75, -1])
  })

  it('preserves one second when resampling 48 kHz to 16 kHz', () => {
    const output = resampleLinear(new Float32Array(48_000), 48_000, 16_000)

    expect(output).toHaveLength(16_000)
  })

  it('interpolates between source samples', () => {
    const output = resampleLinear(new Float32Array([0, 1]), 2, 4)

    expect([...output]).toEqual([0, 0.5, 1, 1])
  })

  it('writes mono PCM16 WAV metadata and samples', () => {
    const wav = encodePcm16Wav(new Float32Array([0, 1, -1]), 16_000)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)

    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(6)
    expect(view.getInt16(44, true)).toBe(0)
    expect(view.getInt16(46, true)).toBe(32_767)
    expect(view.getInt16(48, true)).toBe(-32_768)
  })

  it.each([
    () => downmixToMono([]),
    () => downmixToMono([new Float32Array(2), new Float32Array(3)]),
    () => resampleLinear(new Float32Array(2), 0, 16_000),
    () => encodePcm16Wav(new Float32Array(2), -1)
  ])('rejects invalid audio metadata', (operation) => {
    expect(operation).toThrowError(expect.objectContaining({ code: 'audio_conversion_failed' }))
  })

  it('stops conversion when its signal is already aborted', () => {
    const controller = new AbortController()
    controller.abort()

    expect(() => downmixToMono([new Float32Array(5_000)], controller.signal)).toThrowError(
      expect.objectContaining({ code: 'cancelled' })
    )
  })
})
