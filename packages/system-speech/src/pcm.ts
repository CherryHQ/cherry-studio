import { speechError, throwIfAborted } from './contracts'

const ABORT_CHECK_INTERVAL = 4096

function assertPositiveSampleRate(sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw speechError('audio_conversion_failed')
  }
}

function checkAbort(signal: AbortSignal | undefined, frame: number): void {
  if (frame % ABORT_CHECK_INTERVAL === 0) {
    throwIfAborted(signal)
  }
}

export function downmixToMono(channels: readonly Float32Array[], signal?: AbortSignal): Float32Array {
  throwIfAborted(signal)
  const frameCount = channels[0]?.length
  if (frameCount === undefined || channels.some((channel) => channel.length !== frameCount)) {
    throw speechError('audio_conversion_failed')
  }

  const mono = new Float32Array(frameCount)
  for (let frame = 0; frame < frameCount; frame += 1) {
    checkAbort(signal, frame)
    let sum = 0
    for (const channel of channels) {
      sum += channel[frame]
    }
    mono[frame] = Math.max(-1, Math.min(1, sum / channels.length))
  }
  return mono
}

export function resampleLinear(
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
  signal?: AbortSignal
): Float32Array {
  throwIfAborted(signal)
  assertPositiveSampleRate(sourceSampleRate)
  assertPositiveSampleRate(targetSampleRate)

  if (input.length === 0) {
    return new Float32Array()
  }

  const outputLength = Math.round((input.length * targetSampleRate) / sourceSampleRate)
  const output = new Float32Array(outputLength)
  const sourceFramesPerOutputFrame = sourceSampleRate / targetSampleRate

  for (let frame = 0; frame < outputLength; frame += 1) {
    checkAbort(signal, frame)
    const sourcePosition = frame * sourceFramesPerOutputFrame
    const lowerIndex = Math.min(Math.floor(sourcePosition), input.length - 1)
    const upperIndex = Math.min(lowerIndex + 1, input.length - 1)
    const fraction = sourcePosition - lowerIndex
    output[frame] = input[lowerIndex] * (1 - fraction) + input[upperIndex] * fraction
  }
  return output
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index)
  }
}

export function encodePcm16Wav(samples: Float32Array, sampleRate: number, signal?: AbortSignal): Uint8Array {
  throwIfAborted(signal)
  assertPositiveSampleRate(sampleRate)

  const dataLength = samples.length * 2
  const bytes = new Uint8Array(44 + dataLength)
  const view = new DataView(bytes.buffer)

  writeAscii(bytes, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeAscii(bytes, 8, 'WAVE')
  writeAscii(bytes, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(bytes, 36, 'data')
  view.setUint32(40, dataLength, true)

  for (let frame = 0; frame < samples.length; frame += 1) {
    checkAbort(signal, frame)
    const sample = Math.max(-1, Math.min(1, samples[frame]))
    view.setInt16(44 + frame * 2, Math.round(sample < 0 ? sample * 32_768 : sample * 32_767), true)
  }

  return bytes
}
