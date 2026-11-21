import { setImmediate } from 'node:timers/promises'

import {
  BufferSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedPacketSink,
  Input,
  OGG,
  Output,
  WavOutputFormat
} from 'mediabunny'
import { OpusDecoder } from 'opus-decoder'

import type { VoiceAudioInput, VoiceAudioResult } from './voiceAudioProcess'

const INVALID = 'VOICE_AUDIO_INVALID'
const UNSUPPORTED = 'VOICE_AUDIO_UNSUPPORTED'
const LIMIT = 'VOICE_AUDIO_LIMIT'
const MAX_BYTES = 32 * 1024 * 1024
const MAX_ITEMS = 200_000
const SAMPLE_RATE = 16_000

function audioError(code: typeof INVALID | typeof UNSUPPORTED | typeof LIMIT): Error {
  return Object.assign(new Error('Invalid voice recording'), { code })
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value << 24
  for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1
  return crc >>> 0
})

function matches(bytes: Uint8Array, offset: number, tag: string): boolean {
  return [...tag].every((character, index) => bytes[offset + index] === character.charCodeAt(0))
}

function inspectTags(bytes: Uint8Array): void {
  if (!matches(bytes, 0, 'OpusTags') || bytes.length < 16) throw audioError(INVALID)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  const text = new TextDecoder('utf-8', { fatal: true })
  const readString = () => {
    if (offset + 4 > bytes.length) throw audioError(INVALID)
    const length = view.getUint32(offset, true)
    offset += 4
    if (length > bytes.length - offset) throw audioError(INVALID)
    text.decode(bytes.subarray(offset, offset + length))
    offset += length
  }
  readString()
  if (offset + 4 > bytes.length) throw audioError(INVALID)
  const count = view.getUint32(offset, true)
  offset += 4
  if (count > (bytes.length - offset) / 4) throw audioError(INVALID)
  for (let index = 0; index < count; index++) readString()
}

type AudioPage = { packets: number; granule: number; eos: boolean }

// Mediabunny's public API omits page granules and does not validate sequential page integrity.
async function inspectContainer(audio: Uint8Array, signal?: AbortSignal) {
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength)
  const pages: AudioPage[] = []
  let offset = 0
  let serial: number | undefined
  let sequence = 0
  let pageCount = 0
  let packetCount = 0
  let packetSize = 0
  let headerParts: Uint8Array[] = []
  let channels = 0
  let preSkip = 0
  let eos = false
  while (offset < audio.length) {
    signal?.throwIfAborted()
    if (++pageCount > MAX_ITEMS) throw audioError(LIMIT)
    if (audio.length - offset < 27 || !matches(audio, offset, 'OggS')) throw audioError(INVALID)
    if (audio[offset + 4] !== 0) throw audioError(UNSUPPORTED)
    const flags = audio[offset + 5]
    if (flags & ~7) throw audioError(INVALID)
    const pageSerial = view.getUint32(offset + 14, true)
    if (serial !== undefined && (pageSerial !== serial || flags & 2)) throw audioError(UNSUPPORTED)
    if (eos) throw audioError(INVALID)
    if (serial === undefined) {
      if (!(flags & 2)) throw audioError(INVALID)
      serial = pageSerial
    }
    if (view.getUint32(offset + 18, true) !== sequence++) throw audioError(INVALID)
    if (Boolean(flags & 1) !== packetSize > 0) throw audioError(INVALID)
    const segments = audio[offset + 26]
    let payload = offset + 27 + segments
    if (payload > audio.length) throw audioError(INVALID)
    let end = payload
    for (let index = 0; index < segments; index++) end += audio[offset + 27 + index]
    if (end > audio.length) throw audioError(INVALID)
    let crc = 0
    for (let index = offset; index < end; index++) {
      const byte = index >= offset + 22 && index < offset + 26 ? 0 : audio[index]
      crc = ((crc << 8) ^ crcTable[(crc >>> 24) ^ byte]) >>> 0
    }
    if (crc !== view.getUint32(offset + 22, true)) throw audioError(INVALID)
    const granuleBig = view.getBigInt64(offset + 6, true)
    if (granuleBig < -1n || granuleBig > BigInt(Number.MAX_SAFE_INTEGER)) throw audioError(INVALID)
    const granule = Number(granuleBig)
    const before = packetCount
    let completed = 0
    for (let index = 0; index < segments; index++) {
      const length = audio[offset + 27 + index]
      if (packetCount < 2) headerParts.push(audio.subarray(payload, payload + length))
      packetSize += length
      payload += length
      if (packetCount >= 2 && packetSize > 3840 * channels) throw audioError(LIMIT)
      if (length === 255) continue
      signal?.throwIfAborted()
      if (!packetSize) throw audioError(INVALID)
      if (packetCount < 2) {
        const header = new Uint8Array(packetSize)
        let position = 0
        for (const part of headerParts) {
          header.set(part, position)
          position += part.length
        }
        headerParts = []
        if (packetCount === 0) {
          if (!matches(header, 0, 'OpusHead')) throw audioError(UNSUPPORTED)
          if (header.length !== 19 || header[8] !== 1 || header[18] !== 0 || ![1, 2].includes(header[9]))
            throw audioError(UNSUPPORTED)
          const headerView = new DataView(header.buffer)
          if (headerView.getInt16(16, true) !== 0) throw audioError(UNSUPPORTED)
          channels = header[9]
          preSkip = headerView.getUint16(10, true)
        } else inspectTags(header)
      } else completed++
      if (++packetCount > MAX_ITEMS) throw audioError(LIMIT)
      packetSize = 0
      if (packetCount % 32 === 0) await setImmediate()
    }
    eos = Boolean(flags & 4)
    if (pageCount === 1 && (packetCount !== 1 || packetSize || granule !== 0)) throw audioError(INVALID)
    if (completed) {
      if (granule < 0) throw audioError(INVALID)
      pages.push({ packets: packetCount - 2, granule, eos })
    } else {
      if (granule !== (packetCount > before ? 0 : -1)) throw audioError(INVALID)
      if (eos) throw audioError(INVALID)
    }
    if (before < 2 && completed) throw audioError(INVALID)
    if (eos && packetSize) throw audioError(INVALID)
    offset = end
    if (pageCount % 32 === 0) await setImmediate()
  }
  if (!eos || !pages.length || packetSize) throw audioError(INVALID)
  return { pages, channels, preSkip, packetCount: packetCount - 2 }
}

/** Runs only in the private Voice utility process; no file, network or application access. */
export async function decodeOgg(input: VoiceAudioInput, signal?: AbortSignal): Promise<VoiceAudioResult> {
  signal?.throwIfAborted()
  if (!/^\s*audio\/ogg\s*(?:;\s*codecs\s*=\s*"?opus"?\s*)?$/i.test(input.mimeType)) throw audioError(UNSUPPORTED)
  if (!(input.audio instanceof Uint8Array) || !input.audio.length) throw audioError(INVALID)
  if (input.audio.length > MAX_BYTES) throw audioError(LIMIT)
  let decoder: OpusDecoder<16000> | undefined
  let decoderReady = false
  const media = new Input({ source: new BufferSource(input.audio), formats: [OGG] })
  try {
    const metadata = await inspectContainer(input.audio, signal)
    const tracks = await media.getTracks()
    if (tracks.length !== 1 || tracks[0].type !== 'audio') throw audioError(UNSUPPORTED)
    const [track] = await media.getAudioTracks()
    if ((await track.getCodec()) !== 'opus' || (await track.getNumberOfChannels()) !== metadata.channels)
      throw audioError(UNSUPPORTED)
    const { channels, preSkip, pages } = metadata
    decoder = new OpusDecoder({ sampleRate: SAMPLE_RATE, channels, preSkip: Math.round(preSkip / 3) })
    await decoder.ready
    decoderReady = true
    const chunks: Uint8Array[] = []
    let samples = 0
    let rawSamples = 0
    let packets = 0
    let pageIndex = 0
    let baseline: number | undefined
    let previousGranule = 0
    let keptSamples = 0
    for await (const packet of new EncodedPacketSink(track).packets()) {
      signal?.throwIfAborted()
      if (packet.data.length > 3840 * channels) throw audioError(LIMIT)
      const packetSamples = Math.round(packet.duration * 48_000)
      if (packetSamples <= 0 || packetSamples > 5760) throw audioError(INVALID)
      rawSamples += packetSamples
      if (rawSamples > 300 * 48_000 + preSkip + 5760) throw audioError(LIMIT)
      const page = pages[pageIndex]
      if (!page || ++packets > metadata.packetCount) throw audioError(INVALID)
      if (packets === page.packets) {
        if (baseline === undefined) {
          baseline = page.granule - rawSamples
          if (baseline < 0) {
            if (!page.eos) throw audioError(INVALID)
            baseline = 0
          }
          previousGranule = baseline
        }
        if (page.eos) {
          const end = baseline + rawSamples
          if (page.granule < previousGranule || page.granule > end) throw audioError(INVALID)
          if (end - page.granule > packetSamples) throw audioError(UNSUPPORTED)
          const retained = page.granule - baseline - preSkip
          if (retained <= 0) throw audioError(INVALID)
          if (retained > 300 * 48_000) throw audioError(LIMIT)
          if (rawSamples > 300 * 48_000 + preSkip + packetSamples) throw audioError(LIMIT)
          keptSamples = Math.round(retained / 3)
        } else if (page.granule !== baseline + rawSamples) throw audioError(INVALID)
        previousGranule = page.granule
        pageIndex++
      }
      const decoded = decoder.decodeFrame(packet.data)
      if (decoded.errors.length) throw audioError(INVALID)
      samples += decoded.samplesDecoded
      if (samples > 4_800_000 + 1920) throw audioError(LIMIT)
      const chunk = new Uint8Array(decoded.samplesDecoded * 2)
      const view = new DataView(chunk.buffer)
      for (let index = 0; index < decoded.samplesDecoded; index++) {
        const sample = decoded.channelData.reduce((sum, channel) => sum + channel[index], 0) / channels
        const clipped = Math.max(-1, Math.min(1, sample))
        view.setInt16(index * 2, Math.round(clipped * (clipped < 0 ? 32768 : 32767)), true)
      }
      chunks.push(chunk)
      if (packets % 32 === 0) await setImmediate()
    }
    signal?.throwIfAborted()
    if (!keptSamples || keptSamples > samples || packets !== metadata.packetCount || pageIndex !== pages.length)
      throw audioError(INVALID)
    const pcm = new Uint8Array(keptSamples * 2)
    let offset = 0
    for (const chunk of chunks) {
      const kept = chunk.subarray(0, pcm.length - offset)
      pcm.set(kept, offset)
      offset += kept.length
      if (offset === pcm.length) break
    }
    const target = new BufferTarget()
    const output = new Output({ format: new WavOutputFormat(), target })
    const source = new EncodedAudioPacketSource('pcm-s16')
    output.addAudioTrack(source)
    await output.start()
    const durationSeconds = keptSamples / SAMPLE_RATE
    await source.add(new EncodedPacket(pcm, 'key', 0, durationSeconds), {
      decoderConfig: { codec: 'pcm-s16', sampleRate: SAMPLE_RATE, numberOfChannels: 1 }
    })
    await output.finalize()
    signal?.throwIfAborted()
    return { wav: new Uint8Array(target.buffer!), sampleRate: SAMPLE_RATE, channels: 1, durationSeconds }
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof Error && 'code' in error && [INVALID, UNSUPPORTED, LIMIT].includes(String(error.code)))
      throw error
    throw audioError(INVALID)
  } finally {
    if (decoderReady) decoder?.free()
    media.dispose()
  }
}
