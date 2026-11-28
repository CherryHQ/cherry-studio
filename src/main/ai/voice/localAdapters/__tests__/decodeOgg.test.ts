import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { EncodedPacketSink } from 'mediabunny'
import { describe, expect, it, vi } from 'vitest'

import { decodeOgg } from '../decodeOgg'
import { inspectCanonicalWav } from '../inspectCanonicalWav'

const recording = new Uint8Array(
  readFileSync(fileURLToPath(new URL('./fixtures/media-recorder-opus.ogg', import.meta.url)))
)
const mimeType = 'audio/ogg'
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value << 24
  for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1
  return crc >>> 0
})

function checksum(page: Uint8Array): Uint8Array {
  const view = new DataView(page.buffer, page.byteOffset, page.byteLength)
  view.setUint32(22, 0, true)
  let crc = 0
  for (const byte of page) crc = ((crc << 8) ^ crcTable[(crc >>> 24) ^ byte]) >>> 0
  view.setUint32(22, crc, true)
  return page
}

function splitPages(bytes: Uint8Array): Uint8Array[] {
  const pages: Uint8Array[] = []
  for (let offset = 0; offset < bytes.length;) {
    const segments = bytes[offset + 26]
    const end = offset + 27 + segments + bytes.subarray(offset + 27, offset + 27 + segments).reduce((a, b) => a + b, 0)
    pages.push(bytes.slice(offset, end))
    offset = end
  }
  return pages
}

function concat(parts: Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(parts))
}

const fixturePages = splitPages(recording)
const head = fixturePages[0].slice(28)
const tags = fixturePages[1].slice(28)
const packets: Uint8Array[] = []
let payload = 27 + fixturePages[2][26]
let packetStart = payload
for (const length of fixturePages[2].subarray(27, payload)) {
  payload += length
  if (length < 255) {
    packets.push(fixturePages[2].slice(packetStart, payload))
    packetStart = payload
  }
}

function page(data: Uint8Array[], sequence: number, granule: number, flags = 0, serial = 1): Uint8Array {
  const laces = data.flatMap((packet) => [...Array(Math.floor(packet.length / 255)).fill(255), packet.length % 255])
  if (laces.length > 255) throw new Error('Test page too large')
  const bytes = new Uint8Array(27 + laces.length + data.reduce((sum, packet) => sum + packet.length, 0))
  bytes.set(new TextEncoder().encode('OggS'))
  bytes[5] = flags
  const view = new DataView(bytes.buffer)
  view.setBigInt64(6, BigInt(granule), true)
  view.setUint32(14, serial, true)
  view.setUint32(18, sequence, true)
  bytes[26] = laces.length
  bytes.set(laces, 27)
  bytes.set(concat(data), 27 + laces.length)
  return checksum(bytes)
}

function stream(options: { preSkip?: number; baseline?: number; end?: number; count?: number; group?: number } = {}) {
  const header = head.slice()
  new DataView(header.buffer).setUint16(10, options.preSkip ?? 0, true)
  const count = options.count ?? 16
  const baseline = options.baseline ?? 0
  const group = options.group ?? 8
  const pages = [page([header], 0, 0, 2), page([tags], 1, 0)]
  for (let index = 0; index < count; index += group) {
    const end = Math.min(count, index + group)
    const eos = end === count
    pages.push(
      page(
        Array.from({ length: end - index }, (_, i) => packets[(index + i) % 16]),
        pages.length,
        eos ? (options.end ?? baseline + count * 2880) : baseline + end * 2880,
        eos ? 4 : 0
      )
    )
  }
  return concat(pages)
}

function edited(edit: (pages: Uint8Array[]) => void): Uint8Array {
  const pages = splitPages(recording)
  edit(pages)
  return concat(pages.map(checksum))
}

function paddedStream(totalBytes: number): Uint8Array {
  const audio = page(packets, 0, 46080, 4)
  const first = page([head], 0, 0, 2)
  const containerSize = (length: number) => {
    const laces = Math.floor(length / 255) + 1
    return first.length + audio.length + length + laces + 27 * Math.ceil(laces / 255)
  }
  let tagBytes = totalBytes - first.length - audio.length
  while (containerSize(tagBytes) !== totalBytes) tagBytes += totalBytes - containerSize(tagBytes)
  const paddedTags = new Uint8Array(tagBytes)
  paddedTags.set(tags)
  const laces = [...Array(Math.floor(tagBytes / 255)).fill(255), tagBytes % 255]
  const pages = [first]
  let offset = 0
  for (let index = 0; index < laces.length; index += 255) {
    const table = laces.slice(index, index + 255)
    const length = table.reduce((a, b) => a + b, 0)
    const bytes = new Uint8Array(27 + table.length + length)
    bytes.set(new TextEncoder().encode('OggS'))
    bytes[5] = index ? 1 : 0
    const view = new DataView(bytes.buffer)
    view.setBigInt64(6, index + 255 < laces.length ? -1n : 0n, true)
    view.setUint32(14, 1, true)
    view.setUint32(18, pages.length, true)
    bytes[26] = table.length
    bytes.set(table, 27)
    bytes.set(paddedTags.subarray(offset, offset + length), 27 + table.length)
    pages.push(checksum(bytes))
    offset += length
  }
  new DataView(audio.buffer).setUint32(18, pages.length, true)
  pages.push(checksum(audio))
  return concat(pages)
}

async function samples(audio: Uint8Array): Promise<number> {
  const result = await decodeOgg({ audio, mimeType })
  const inspected = inspectCanonicalWav(result.wav)
  expect(result.durationSeconds).toBe(inspected.durationSeconds)
  return inspected.dataBytes / 2
}

async function rejects(audio: Uint8Array, category = 'INVALID') {
  await expect(decodeOgg({ audio, mimeType })).rejects.toMatchObject({
    code: `VOICE_AUDIO_${category}`,
    message: 'Invalid voice recording'
  })
}

describe('private Voice OGG decoder', () => {
  it('preserves all 15360 samples and both stereo tones in canonical mono 16 kHz WAV', async () => {
    const result = await decodeOgg({ audio: recording, mimeType })
    expect(result).toMatchObject({ sampleRate: 16000, channels: 1, durationSeconds: 0.96 })
    const inspected = inspectCanonicalWav(result.wav)
    expect(inspected.dataBytes / 2).toBe(15360)
    const view = new DataView(result.wav.buffer, result.wav.byteOffset + inspected.dataOffset, inspected.dataBytes)
    for (const frequency of [440, 880]) {
      let real = 0
      let imaginary = 0
      for (let i = 2000; i < 10000; i++) {
        const angle = (2 * Math.PI * frequency * i) / 16000
        const value = view.getInt16(i * 2, true) / 32768
        real += value * Math.cos(angle)
        imaginary += value * Math.sin(angle)
      }
      expect((2 * Math.hypot(real, imaginary)) / 8000).toBeCloseTo(0.1, 1)
    }
  })

  it('applies pre-skip once and trims by EOS granule', async () => {
    const audio = edited((pages) => {
      new DataView(pages[0].buffer).setUint16(28 + 10, 312, true)
      new DataView(pages[2].buffer).setBigInt64(6, 45600n, true)
    })
    expect(await samples(audio)).toBe(15096)
  })

  it.each([312, 313, 314, 6000])('handles rounding and cross-packet pre-skip %i', async (preSkip) => {
    expect(await samples(stream({ preSkip }))).toBe(Math.round((46080 - preSkip) / 3))
  })

  it('accounts for nonzero initial granule baseline across multiple audio pages', async () => {
    expect(await samples(stream({ baseline: 12000, preSkip: 312, end: 12000 + 45600 }))).toBe(15096)
  })

  it('supports a single audio page ending before its decoded sample count', async () => {
    expect(await samples(stream({ group: 16, preSkip: 312, end: 45600 }))).toBe(15096)
  })

  it('rejects trimming beyond the last packet', async () => {
    await rejects(stream({ group: 16, end: 46080 - 2881 }), 'UNSUPPORTED')
  })

  it.each([
    new Uint8Array(),
    new TextEncoder().encode('damaged'),
    recording.subarray(0, 30),
    recording.subarray(0, -1)
  ])('rejects empty, corrupt and truncated bytes', async (audio) => rejects(audio))

  it('rejects missing EOS', async () =>
    rejects(
      edited((pages) => {
        pages[2][5] = 0
      })
    ))
  it('rejects invalid CRC', async () => {
    const bytes = recording.slice()
    bytes[bytes.length - 1] ^= 1
    await rejects(bytes)
  })
  it('rejects garbage after EOS', async () => rejects(concat([recording, new Uint8Array([1])])))
  it('rejects chaining', async () => rejects(concat([recording, recording]), 'UNSUPPORTED'))
  it('rejects multiplexed streams', async () =>
    rejects(
      edited((pages) => {
        const extra = page([head], 0, 0, 2, 2)
        pages.splice(1, 0, extra)
      }),
      'UNSUPPORTED'
    ))

  it.each([
    (pages: Uint8Array[]) => {
      new DataView(pages[2].buffer).setBigInt64(6, -2n, true)
    },
    (pages: Uint8Array[]) => {
      new DataView(pages[2].buffer).setBigInt64(6, -1n, true)
    },
    (pages: Uint8Array[]) => {
      new DataView(pages[2].buffer).setUint32(18, 4, true)
    },
    (pages: Uint8Array[]) => {
      pages[2][5] |= 1
    },
    (pages: Uint8Array[]) => {
      pages[1][28] = 0
    },
    (pages: Uint8Array[]) => {
      new DataView(pages[1].buffer).setUint32(36, 0xffffffff, true)
    }
  ])('rejects invalid granules, sequence, continuation or tags', async (edit) => rejects(edited(edit)))

  it('rejects an EOS granule beyond the decoded total', async () => rejects(stream({ end: 46081 })))

  it('rejects negative initial baseline on a non-EOS page', async () => {
    const pages = splitPages(stream())
    new DataView(pages[2].buffer).setBigInt64(6, 23039n, true)
    await rejects(concat(pages.map(checksum)))
  })
  it('rejects a discontinuous intermediate granule', async () => {
    const pages = splitPages(stream({ count: 24 }))
    new DataView(pages[3].buffer).setBigInt64(6, 46079n, true)
    await rejects(concat(pages.map(checksum)))
  })
  it('rejects an EOS granule before the previous page', async () => rejects(stream({ end: 23039 })))
  it('rejects empty retained PCM', async () => rejects(stream({ group: 16, preSkip: 46080 })))

  it.each([
    (header: Uint8Array) => {
      header.set(new TextEncoder().encode('\x01vorbis'))
    },
    (header: Uint8Array) => {
      header[9] = 3
    },
    (header: Uint8Array) => {
      header[16] = 1
    },
    (header: Uint8Array) => {
      header[8] = 2
    },
    (header: Uint8Array) => {
      header[18] = 1
    }
  ])('rejects non-Opus and unsupported OpusHead configurations', async (edit) => {
    const header = head.slice()
    edit(header)
    await rejects(
      concat([
        page([header], 0, 0, 2, new DataView(fixturePages[0].buffer).getUint32(14, true)),
        ...fixturePages.slice(1)
      ]),
      'UNSUPPORTED'
    )
  })

  it('accepts exactly 300 seconds and rejects one additional 48 kHz sample', async () => {
    expect(await samples(stream({ count: 5000, group: 100 }))).toBe(4800000)
    await rejects(stream({ count: 5001, group: 100, end: 14400001 }), 'LIMIT')
  }, 30000)

  it('rejects raw overlong decoding even when an EOS granule conceals it', async () => {
    await rejects(stream({ count: 5100, group: 100, end: 46080 }), 'LIMIT')
  }, 30000)

  it('accepts a parseable 32 MiB stream and rejects one additional encoded byte', async () => {
    const exact = paddedStream(32 * 1024 * 1024)
    expect(exact.length).toBe(32 * 1024 * 1024)
    expect(await samples(exact)).toBe(15360)
    const above = paddedStream(32 * 1024 * 1024 + 1)
    expect(above.length).toBe(32 * 1024 * 1024 + 1)
    await rejects(above, 'LIMIT')
  }, 30000)

  it('preserves pre-cancellation and an abort inside the real packet loop', async () => {
    const reason = new Error('cancel OGG')
    const early = AbortSignal.abort(reason)
    await expect(decodeOgg({ audio: recording, mimeType }, early)).rejects.toBe(reason)
    const controller = new AbortController()
    const original = EncodedPacketSink.prototype.packets
    const spy = vi.spyOn(EncodedPacketSink.prototype, 'packets').mockImplementation(async function* (
      this: EncodedPacketSink,
      ...args
    ) {
      let count = 0
      for await (const packet of original.apply(this, args)) {
        if (++count === 2) controller.abort(reason)
        yield packet
      }
    })
    try {
      await expect(decodeOgg({ audio: recording, mimeType }, controller.signal)).rejects.toBe(reason)
    } finally {
      spy.mockRestore()
    }
    expect(await samples(recording)).toBe(15360)
  })
})
