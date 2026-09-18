import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { BufferSource, EncodedPacketSink, Input, WAVE } from 'mediabunny'
import { Decoder, Encoder, type EBMLElementBuffer } from 'ts-ebml'
import { describe, expect, it } from 'vitest'

import { decodeWebm } from '../decodeWebm'

const recording = new Uint8Array(
  readFileSync(fileURLToPath(new URL('./fixtures/media-recorder-opus.webm', import.meta.url)))
)
const mimeType = 'audio/webm;codecs=opus'

function editedRecording(edit: (elements: EBMLElementBuffer[]) => void): Uint8Array {
  const decoded = new Decoder().decode(recording.buffer)
  let skipFrom = 0
  let skipUntil = 0
  const elements = decoded.filter((element) => {
    if (element.tagStart >= skipFrom && element.tagStart < skipUntil) return false
    if (element.name === 'SeekHead' || element.name === 'Cues') {
      skipUntil = element.dataEnd
      skipFrom = element.tagStart
      return false
    }
    return true
  })
  edit(elements)
  return new Uint8Array(new Encoder().encode(elements))
}

describe('private Voice WebM decoder', () => {
  it('decodes a real stereo MediaRecorder WebM into a complete mono 16 kHz WAV', async () => {
    const result = await decodeWebm({ audio: recording, mimeType })
    expect(result).toMatchObject({ sampleRate: 16_000, channels: 1, durationSeconds: 0.96 })
    const input = new Input({ source: new BufferSource(result.wav), formats: [WAVE] })
    try {
      const tracks = await input.getAudioTracks()
      expect(tracks).toHaveLength(1)
      expect(await tracks[0].getCodec()).toBe('pcm-s16')
      expect(await tracks[0].getSampleRate()).toBe(16_000)
      expect(await tracks[0].getNumberOfChannels()).toBe(1)
      expect(await tracks[0].computeDuration()).toBeCloseTo(0.96, 5)
      expect(result.wav.subarray(0, 4)).toEqual(new TextEncoder().encode('RIFF'))
      expect(result.wav.subarray(8, 12)).toEqual(new TextEncoder().encode('WAVE'))
      const packets: Uint8Array[] = []
      for await (const packet of new EncodedPacketSink(tracks[0]).packets()) packets.push(packet.data)
      const pcm = Buffer.concat(packets)
      const samples = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
      for (const frequency of [440, 880]) {
        let real = 0
        let imaginary = 0
        for (let i = 2_000; i < 10_000; i++) {
          const angle = (2 * Math.PI * frequency * i) / 16_000
          const value = samples.getInt16(i * 2, true) / 32768
          real += value * Math.cos(angle)
          imaginary += value * Math.sin(angle)
        }
        expect((2 * Math.hypot(real, imaginary)) / 8_000).toBeCloseTo(0.1, 1)
      }
    } finally {
      input.dispose()
    }
  })

  it.each(['audio/wav', 'audio/webm', 'audio/webm;codecs=vorbis'])(
    'rejects unsupported MIME %s',
    async (unsupported) => {
      await expect(decodeWebm({ audio: recording, mimeType: unsupported })).rejects.toMatchObject({
        code: 'VOICE_AUDIO_UNSUPPORTED'
      })
    }
  )

  it.each([new Uint8Array(), new TextEncoder().encode('RIFF0000WAVE'), recording.subarray(0, 30)])(
    'rejects empty, WAV-only, and truncated input without exposing its contents',
    async (audio) => {
      await expect(decodeWebm({ audio, mimeType })).rejects.toMatchObject({
        code: 'VOICE_AUDIO_INVALID',
        message: 'Invalid voice recording'
      })
    }
  )

  it('bounds encoded memory before attempting demux', async () => {
    await expect(decodeWebm({ audio: new Uint8Array(32 * 1024 * 1024 + 1), mimeType })).rejects.toMatchObject({
      code: 'VOICE_AUDIO_LIMIT'
    })
  })

  it('rejects an incomplete trailing element even when the enclosing segment length appears complete', async () => {
    const audio = editedRecording((elements) => {
      elements.splice(elements.length - 1, 0, { name: 'Void', type: 'b', data: Buffer.from([1]) })
    })
    const tail = new Decoder()
      .decode(audio.slice().buffer)
      .filter((element) => element.name === 'Void')
      .at(-1)!
    audio[tail.dataStart - 1] = 0x82
    await expect(decodeWebm({ audio, mimeType })).rejects.toMatchObject({ code: 'VOICE_AUDIO_INVALID' })
  })

  it('removes Opus pre-skip and final discard padding without using imprecise recorder timestamps', async () => {
    const audio = editedRecording((elements) => {
      const header = elements.find((element) => element.name === 'CodecPrivate')!
      if (header.type === 'm') throw new Error('Missing Opus header')
      header.data = Buffer.from(header.data)
      header.data.writeUInt16LE(312, 10)
      const index = elements.findLastIndex((element) => element.name === 'SimpleBlock')
      const block = elements[index]
      elements.splice(
        index,
        1,
        { name: 'BlockGroup', type: 'm', isEnd: false },
        { ...block, name: 'Block' },
        { name: 'DiscardPadding', type: 'i', data: Buffer.from([0, 0x98, 0x96, 0x80]) },
        { name: 'BlockGroup', type: 'm', isEnd: true }
      )
    })
    const result = await decodeWebm({ audio, mimeType })
    expect(result.durationSeconds).toBe((15_360 - 104 - 160) / 16_000)
  })

  it('rejects audio tracks with a different codec instead of interpreting them as Opus', async () => {
    const audio = editedRecording((elements) => {
      const codec = elements.find((element) => element.name === 'CodecID')!
      if (codec.type !== 'm') codec.data = Buffer.from('A_VORBIS')
    })
    await expect(decodeWebm({ audio, mimeType })).rejects.toMatchObject({ code: 'VOICE_AUDIO_UNSUPPORTED' })
  })

  it('rejects an extra audio track instead of silently choosing one', async () => {
    const audio = editedRecording((elements) => {
      const start = elements.findIndex((element) => element.name === 'TrackEntry')
      const end = elements.findIndex(
        (element) => element.name === 'TrackEntry' && element.type === 'm' && element.isEnd
      )
      const duplicate = elements
        .slice(start, end + 1)
        .map((element) => (element.name === 'TrackNumber' ? { ...element, data: Buffer.from([2]) } : element))
      elements.splice(end + 1, 0, ...duplicate)
    })
    await expect(decodeWebm({ audio, mimeType })).rejects.toMatchObject({ code: 'VOICE_AUDIO_UNSUPPORTED' })
  })

  it('rejects more than five minutes of decoded samples even when metadata understates the duration', async () => {
    const audio = editedRecording((elements) => {
      const index = elements.findIndex((element) => element.name === 'SimpleBlock')
      const block = elements[index]
      elements.splice(index, 0, ...Array.from({ length: 5_000 }, () => block))
    })
    await expect(decodeWebm({ audio, mimeType })).rejects.toMatchObject({ code: 'VOICE_AUDIO_LIMIT' })
  })

  it('rejects laced packets that cannot be mapped safely to discard padding', async () => {
    const audio = editedRecording((elements) => {
      const block = elements.find((element) => element.name === 'SimpleBlock')!
      if (block.type === 'm') throw new Error('Missing audio block')
      block.data = Buffer.from(block.data)
      block.data[3] |= 0x02
    })
    await expect(decodeWebm({ audio, mimeType })).rejects.toMatchObject({ code: 'VOICE_AUDIO_UNSUPPORTED' })
  })

  it('preserves the caller abort and permits the next independent decode', async () => {
    const controller = new AbortController()
    const reason = new Error('cancel voice decode')
    controller.abort(reason)
    await expect(decodeWebm({ audio: recording, mimeType }, controller.signal)).rejects.toBe(reason)
    await expect(decodeWebm({ audio: recording, mimeType })).resolves.toMatchObject({ durationSeconds: 0.96 })
  })
})
