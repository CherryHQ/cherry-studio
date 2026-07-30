export interface DecodedPlaybackAudio {
  bytes: Uint8Array
  mediaType: string
}

export interface DecodedPcmWav {
  bitsPerSample: number
  channels: Float32Array[]
  sampleRate: number
}

interface WavFormat {
  audioFormat: number
  bitsPerSample: number
  channelCount: number
  dataOffset: number
  dataSize: number
  sampleRate: number
}

function readAscii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end))
}

function getWavFormat(bytes: Uint8Array): WavFormat | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 12
  let audioFormat: number | null = null
  let bitsPerSample: number | null = null
  let channelCount: number | null = null
  let sampleRate: number | null = null
  let dataOffset: number | null = null
  let dataSize: number | null = null

  while (offset + 8 <= bytes.length) {
    const chunkId = readAscii(bytes, offset, offset + 4)
    const chunkSize = view.getUint32(offset + 4, true)
    const chunkDataOffset = offset + 8
    const chunkDataEnd = Math.min(chunkDataOffset + chunkSize, bytes.length)

    if (chunkId === 'fmt ') {
      if (chunkSize < 16 || chunkDataOffset + 16 > bytes.length) return null
      audioFormat = view.getUint16(chunkDataOffset, true)
      if (audioFormat !== 1 && audioFormat !== 3) return null
      channelCount = view.getUint16(chunkDataOffset + 2, true)
      sampleRate = view.getUint32(chunkDataOffset + 4, true)
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true)
    } else if (chunkId === 'data') {
      dataOffset = chunkDataOffset
      dataSize = chunkDataEnd - chunkDataOffset
    }
    offset = chunkDataOffset + chunkSize + (chunkSize % 2)
  }

  if (
    audioFormat === null ||
    bitsPerSample === null ||
    channelCount === null ||
    sampleRate === null ||
    dataOffset === null ||
    dataSize === null ||
    channelCount < 1 ||
    sampleRate < 1 ||
    dataSize < 1
  ) {
    return null
  }
  return { audioFormat, bitsPerSample, channelCount, sampleRate, dataOffset, dataSize }
}

function getWavFormatDescription(bytes: Uint8Array): string | null {
  const format = getWavFormat(bytes)
  if (!format) return null
  return format.audioFormat === 1 ? 'PCM' : 'IEEE_FLOAT'
}

export function inferPlayableAudioMediaType(bytes: Uint8Array): string | null {
  if (bytes.length >= 12 && readAscii(bytes, 0, 4) === 'RIFF' && readAscii(bytes, 8, 12) === 'WAVE') {
    return getWavFormatDescription(bytes) ? 'audio/wav' : null
  }
  if (bytes.length >= 3 && readAscii(bytes, 0, 3) === 'ID3') return 'audio/mpeg'
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  if (bytes.length >= 4 && readAscii(bytes, 0, 4) === 'OggS') return 'audio/ogg'
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'audio/webm'
  }
  if (bytes.length >= 12 && readAscii(bytes, 4, 8) === 'ftyp') return 'audio/mp4'
  return null
}

export function decodePlaybackAudio(audioBase64: string, fallbackMediaType: string): DecodedPlaybackAudio {
  const normalizedAudioBase64 = audioBase64.replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '')
  const binary = atob(normalizedAudioBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  const mediaType = inferPlayableAudioMediaType(bytes)
  if (!mediaType) {
    const prefix = Array.from(bytes.slice(0, 16))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    throw new Error(
      `Speech synthesis returned unsupported audio bytes (declared media type: ${fallbackMediaType}; bytes: ${bytes.length}; prefix: ${prefix})`
    )
  }

  return { bytes, mediaType }
}

export function decodePcmWav(bytes: Uint8Array): DecodedPcmWav {
  if (bytes.length < 12 || readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 12) !== 'WAVE') {
    throw new Error('Expected a WAV audio container')
  }

  const format = getWavFormat(bytes)
  if (!format) throw new Error('WAV audio is missing a supported PCM fmt/data chunk')
  if (format.audioFormat === 3 && format.bitsPerSample !== 32) {
    throw new Error(`Only 32-bit float WAV audio is supported, received ${format.bitsPerSample}-bit float`)
  }
  if (format.audioFormat === 1 && ![8, 16, 24, 32].includes(format.bitsPerSample)) {
    throw new Error(`Unsupported PCM WAV bit depth: ${format.bitsPerSample}`)
  }

  const bytesPerSample = format.bitsPerSample / 8
  const frameSize = bytesPerSample * format.channelCount
  const frameCount = Math.floor(format.dataSize / frameSize)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const channels = Array.from({ length: format.channelCount }, () => new Float32Array(frameCount))

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameOffset = format.dataOffset + frameIndex * frameSize
    for (let channelIndex = 0; channelIndex < format.channelCount; channelIndex += 1) {
      const sampleOffset = frameOffset + channelIndex * bytesPerSample
      let sample: number
      if (format.audioFormat === 3) {
        sample = view.getFloat32(sampleOffset, true)
      } else if (format.bitsPerSample === 8) {
        sample = (bytes[sampleOffset] - 128) / 128
      } else if (format.bitsPerSample === 16) {
        sample = view.getInt16(sampleOffset, true) / 32768
      } else if (format.bitsPerSample === 24) {
        const raw = bytes[sampleOffset] | (bytes[sampleOffset + 1] << 8) | (bytes[sampleOffset + 2] << 16)
        sample = ((raw & 0x800000 ? raw | 0xff000000 : raw) << 8) / 2147483648
      } else {
        sample = view.getInt32(sampleOffset, true) / 2147483648
      }
      channels[channelIndex][frameIndex] = Math.max(-1, Math.min(1, sample))
    }
  }

  return {
    bitsPerSample: format.bitsPerSample,
    channels,
    sampleRate: format.sampleRate
  }
}
