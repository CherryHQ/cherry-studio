import { setImmediate } from 'node:timers/promises'

import {
  BufferSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedPacketSink,
  Input,
  Output,
  WavOutputFormat,
  WEBM
} from 'mediabunny'
import { OpusDecoder } from 'opus-decoder'
import { Decoder, tools } from 'ts-ebml'

import type { VoiceAudioInput, VoiceAudioResult } from './voiceAudioProcess'

const SAMPLE_RATE = 16_000
const MAX_SAMPLES = 300 * SAMPLE_RATE
const MAX_INPUT_BYTES = 32 * 1024 * 1024
const INVALID = 'VOICE_AUDIO_INVALID'
const UNSUPPORTED = 'VOICE_AUDIO_UNSUPPORTED'
const LIMIT = 'VOICE_AUDIO_LIMIT'

function audioError(code: typeof INVALID | typeof UNSUPPORTED | typeof LIMIT): Error {
  return Object.assign(new Error('Invalid voice recording'), { code })
}

// Mediabunny does not expose DiscardPadding; only ts-ebml reads container metadata here.
function inspectContainer(audio: Uint8Array): { packetCount: number; padding: number; codecDelay?: number } {
  const decoder = new Decoder()
  let consumed = 0
  let packetCount = 0
  let padding = 0
  let codecDelay: number | undefined
  let blockGroup = false
  let documentType = ''
  let elementsRead = 0
  for (let offset = 0; offset < audio.length; offset += 65_536) {
    const elements = decoder.decode(audio.slice(offset, offset + 65_536).buffer)
    for (const element of elements) {
      if (++elementsRead > 200_000) throw audioError(LIMIT)
      if (element.dataEnd > audio.length) throw audioError(INVALID)
      if (element.type === 'm') {
        consumed = Math.max(consumed, element.dataStart)
        if (element.name === 'BlockGroup') blockGroup = !element.isEnd
        if (['ContentEncodings', 'Attachments'].includes(element.name)) throw audioError(UNSUPPORTED)
        continue
      }
      consumed = Math.max(consumed, element.dataEnd)
      if (element.name === 'DocType') documentType = String(element.value)
      if (element.name === 'CodecDelay') {
        codecDelay = Number(element.value)
        if (!Number.isSafeInteger(codecDelay) || codecDelay < 0 || codecDelay > 2e9) throw audioError(INVALID)
      }
      if (element.name === 'SimpleBlock' || element.name === 'Block') {
        if (padding !== 0) throw audioError(UNSUPPORTED)
        const track = tools.readVint(element.data, 0)
        if (!track || element.data.length <= track.length + 3) throw audioError(INVALID)
        if (element.data[track.length + 2] & 0x06) throw audioError(UNSUPPORTED)
        packetCount++
      }
      if (element.name === 'DiscardPadding') {
        if (!blockGroup || !packetCount || padding !== 0) throw audioError(UNSUPPORTED)
        padding = Number(element.value)
        if (!Number.isSafeInteger(padding) || padding < 0 || padding > 120_000_000) throw audioError(UNSUPPORTED)
      }
    }
  }
  if (documentType !== 'webm' || consumed !== audio.length || packetCount === 0) throw audioError(INVALID)
  return { packetCount, padding, codecDelay }
}

/** Runs only in the private Voice utility process; no file, network or application access. */
export async function decodeWebm(input: VoiceAudioInput, signal?: AbortSignal): Promise<VoiceAudioResult> {
  signal?.throwIfAborted()
  if (input.mimeType !== 'audio/webm;codecs=opus') throw audioError(UNSUPPORTED)
  if (!(input.audio instanceof Uint8Array) || input.audio.length === 0) throw audioError(INVALID)
  if (input.audio.length > MAX_INPUT_BYTES) throw audioError(LIMIT)
  let decoder: OpusDecoder<16000> | undefined
  let decoderReady = false
  const media = new Input({ source: new BufferSource(input.audio), formats: [WEBM] })
  try {
    const metadata = inspectContainer(input.audio)
    const tracks = await media.getTracks()
    if (tracks.length !== 1 || tracks[0].type !== 'audio') throw audioError(UNSUPPORTED)
    const [track] = await media.getAudioTracks()
    if ((await track.getCodec()) !== 'opus') throw audioError(UNSUPPORTED)
    const config = await track.getDecoderConfig()
    const channels = await track.getNumberOfChannels()
    const header = config?.description && new Uint8Array(config.description as ArrayBuffer)
    if (!header || header.length !== 19 || ![1, 2].includes(channels) || header[9] !== channels)
      throw audioError(UNSUPPORTED)
    if (new TextDecoder().decode(header.subarray(0, 8)) !== 'OpusHead' || header[8] !== 1 || header[18] !== 0)
      throw audioError(UNSUPPORTED)
    const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength)
    const preSkip = headerView.getUint16(10, true)
    if (headerView.getInt16(16, true) !== 0) throw audioError(UNSUPPORTED)
    if (metadata.codecDelay !== undefined && Math.round((metadata.codecDelay * 48_000) / 1e9) !== preSkip)
      throw audioError(UNSUPPORTED)
    decoder = new OpusDecoder({ sampleRate: SAMPLE_RATE, channels, preSkip: Math.round(preSkip / 3) })
    await decoder.ready
    decoderReady = true
    const chunks: Uint8Array[] = []
    let totalSamples = 0
    let packetsRead = 0
    for await (const packet of new EncodedPacketSink(track).packets()) {
      signal?.throwIfAborted()
      // libopus's WASM input allocation is bounded to 3,840 bytes per channel.
      if (packet.data.length > 3_840 * channels) throw audioError(LIMIT)
      const decoded = decoder.decodeFrame(packet.data)
      if (decoded.errors.length > 0) throw audioError(INVALID)
      if (++packetsRead > metadata.packetCount) throw audioError(INVALID)
      let count = decoded.samplesDecoded
      if (packetsRead === metadata.packetCount) count -= Math.round((metadata.padding * SAMPLE_RATE) / 1e9)
      if (count < 0) throw audioError(INVALID)
      totalSamples += count
      if (totalSamples > MAX_SAMPLES) throw audioError(LIMIT)
      const chunk = new Uint8Array(count * 2)
      const view = new DataView(chunk.buffer)
      for (let index = 0; index < count; index++) {
        const sample = decoded.channelData.reduce((sum, channel) => sum + channel[index], 0) / channels
        const clipped = Math.max(-1, Math.min(1, sample))
        view.setInt16(index * 2, Math.round(clipped * (clipped < 0 ? 32768 : 32767)), true)
      }
      chunks.push(chunk)
      if (packetsRead % 32 === 0) await setImmediate()
    }
    signal?.throwIfAborted()
    if (!totalSamples || packetsRead !== metadata.packetCount) throw audioError(INVALID)
    const pcm = new Uint8Array(totalSamples * 2)
    let offset = 0
    for (const chunk of chunks) {
      pcm.set(chunk, offset)
      offset += chunk.length
    }
    const target = new BufferTarget()
    const output = new Output({ format: new WavOutputFormat(), target })
    const source = new EncodedAudioPacketSource('pcm-s16')
    output.addAudioTrack(source)
    await output.start()
    const durationSeconds = totalSamples / SAMPLE_RATE
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
