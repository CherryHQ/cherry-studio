import { describe, expect, it } from 'vitest'

import { decodePcmWav, decodePlaybackAudio, inferPlayableAudioMediaType } from '../audioPlayback'

function makePcmWavBytes(): Buffer {
  const sampleCount = 2
  const dataSize = sampleCount * 2
  const bytes = Buffer.alloc(44 + dataSize)
  bytes.write('RIFF', 0, 'ascii')
  bytes.writeUInt32LE(36 + dataSize, 4)
  bytes.write('WAVE', 8, 'ascii')
  bytes.write('fmt ', 12, 'ascii')
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(24_000, 24)
  bytes.writeUInt32LE(48_000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36, 'ascii')
  bytes.writeUInt32LE(dataSize, 40)
  bytes.writeInt16LE(0, 44)
  bytes.writeInt16LE(16_384, 46)
  return bytes
}

describe('audioPlayback', () => {
  it('infers playable WAV audio from bytes', () => {
    const bytes = new Uint8Array(makePcmWavBytes())

    expect(inferPlayableAudioMediaType(bytes)).toBe('audio/wav')
  })

  it('decodes base64 audio and uses the real byte media type', () => {
    const decoded = decodePlaybackAudio(makePcmWavBytes().toString('base64'), 'audio/mpeg')

    expect(decoded.mediaType).toBe('audio/wav')
    expect(decoded.bytes.length).toBe(48)
  })

  it('decodes PCM WAV samples for Web Audio playback', () => {
    const decoded = decodePcmWav(new Uint8Array(makePcmWavBytes()))

    expect(decoded.sampleRate).toBe(24_000)
    expect(decoded.bitsPerSample).toBe(16)
    expect(decoded.channels).toHaveLength(1)
    expect(decoded.channels[0]).toHaveLength(2)
    expect(decoded.channels[0][0]).toBe(0)
    expect(decoded.channels[0][1]).toBeCloseTo(0.5, 3)
  })

  it('rejects WAV containers without a supported fmt chunk', () => {
    expect(() => decodePlaybackAudio(Buffer.from('RIFF----WAVE').toString('base64'), 'audio/wav')).toThrow(
      'Speech synthesis returned unsupported audio bytes'
    )
  })

  it('rejects unsupported audio bytes before passing them to the browser audio element', () => {
    expect(() => decodePlaybackAudio(Buffer.from('not audio').toString('base64'), 'audio/wav')).toThrow(
      'Speech synthesis returned unsupported audio bytes'
    )
  })
})
