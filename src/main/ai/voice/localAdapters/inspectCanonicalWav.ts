import { VoiceRuntimeError } from '../VoiceRuntimeError'

const PCM_FORMAT = 1
const CHANNELS = 1
const SAMPLE_RATE = 16_000
const BYTE_RATE = 32_000
const BLOCK_ALIGN = 2
const BITS_PER_SAMPLE = 16

function matchesTag(audio: Uint8Array, offset: number, tag: string): boolean {
  return tag.split('').every((character, index) => audio[offset + index] === character.charCodeAt(0))
}

function invalidAudio(): never {
  throw new VoiceRuntimeError('invalid_audio')
}

export function inspectCanonicalWav(audio: Uint8Array): { durationSeconds: number } {
  if (audio.byteLength < 12) invalidAudio()
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength)
  if (
    !matchesTag(audio, 0, 'RIFF') ||
    view.getUint32(4, true) !== audio.byteLength - 8 ||
    !matchesTag(audio, 8, 'WAVE')
  ) {
    invalidAudio()
  }

  let foundFormat = false
  let dataSize: number | undefined
  let offset = 12

  while (offset < audio.byteLength) {
    if (audio.byteLength - offset < 8) invalidAudio()
    const chunkSize = view.getUint32(offset + 4, true)
    const payloadOffset = offset + 8
    const paddedSize = chunkSize + (chunkSize % 2)
    if (paddedSize > audio.byteLength - payloadOffset) invalidAudio()

    if (matchesTag(audio, offset, 'fmt ')) {
      if (foundFormat || chunkSize < 16) invalidAudio()
      foundFormat = true
      if (
        view.getUint16(payloadOffset, true) !== PCM_FORMAT ||
        view.getUint16(payloadOffset + 2, true) !== CHANNELS ||
        view.getUint32(payloadOffset + 4, true) !== SAMPLE_RATE ||
        view.getUint32(payloadOffset + 8, true) !== BYTE_RATE ||
        view.getUint16(payloadOffset + 12, true) !== BLOCK_ALIGN ||
        view.getUint16(payloadOffset + 14, true) !== BITS_PER_SAMPLE
      ) {
        invalidAudio()
      }
    } else if (matchesTag(audio, offset, 'data')) {
      if (dataSize !== undefined) invalidAudio()
      dataSize = chunkSize
    }

    offset = payloadOffset + paddedSize
  }

  if (!foundFormat || dataSize === undefined || dataSize === 0 || dataSize % BLOCK_ALIGN !== 0) invalidAudio()
  return { durationSeconds: dataSize / BYTE_RATE }
}
