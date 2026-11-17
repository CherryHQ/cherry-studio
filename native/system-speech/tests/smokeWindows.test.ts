import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { inspectPeArchitecture, inspectPcmWav } = require('../scripts/smoke-windows.cjs')

function pe(machine = 0x8664) {
  const bytes = Buffer.alloc(70)
  bytes.write('MZ')
  bytes.writeUInt32LE(64, 0x3c)
  bytes.write('PE\u0000\u0000', 64)
  bytes.writeUInt16LE(machine, 68)
  return bytes
}

function wav() {
  const bytes = Buffer.alloc(48)
  bytes.write('RIFF')
  bytes.writeUInt32LE(40, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16000, 24)
  bytes.writeUInt32LE(32000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(4, 40)
  bytes.writeInt16LE(1200, 44)
  bytes.writeInt16LE(-1200, 46)
  return bytes
}

describe('Windows packaged helper inspection', () => {
  it('rejects ARM64 and x86 executables where an x64 helper is required', () => {
    expect(inspectPeArchitecture(pe())).toBe('x64')
    for (const bytes of [pe(0xaa64), pe(0x14c), pe().subarray(0, 65), Buffer.alloc(0)]) {
      expect(() => inspectPeArchitecture(bytes)).toThrow()
    }
  })

  it('checks WAV audio bytes rather than trusting the helper metadata', () => {
    expect(inspectPcmWav(wav())).toEqual({ sampleRate: 16000, channels: 1, frameCount: 2 })
    const silent = wav()
    silent.fill(0, 44)
    const wrongFormat = wav()
    wrongFormat.writeUInt32LE(44100, 24)
    const truncatedChunk = wav()
    truncatedChunk.writeUInt32LE(8000, 40)
    for (const bytes of [silent, wrongFormat, truncatedChunk, wav().subarray(0, 46)]) {
      expect(() => inspectPcmWav(bytes)).toThrow()
    }
  })
})
