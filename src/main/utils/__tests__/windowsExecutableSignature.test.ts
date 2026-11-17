import { describe, expect, it } from 'vitest'

import { hasPeAuthenticodeSignatureInBuffer } from '../windowsExecutableSignature'

const IMAGE_DIRECTORY_ENTRY_SECURITY = 4

function buildPeBuffer(certificateSize: number): Buffer {
  const buffer = Buffer.alloc(512)
  buffer.writeUInt16LE(0x5a4d, 0)
  buffer.writeUInt32LE(0x80, 0x3c)
  buffer.writeUInt32LE(0x00004550, 0x80)
  buffer.writeUInt16LE(0x20b, 0x98)
  const securityDirectoryOffset = 0x98 + 0x70 + IMAGE_DIRECTORY_ENTRY_SECURITY * 8
  buffer.writeUInt32LE(0x200, securityDirectoryOffset)
  buffer.writeUInt32LE(certificateSize, securityDirectoryOffset + 4)
  return buffer
}

describe('hasPeAuthenticodeSignatureInBuffer', () => {
  it('returns false when the certificate table is empty', () => {
    expect(hasPeAuthenticodeSignatureInBuffer(buildPeBuffer(0))).toBe(false)
  })

  it('returns true when the certificate table is present', () => {
    expect(hasPeAuthenticodeSignatureInBuffer(buildPeBuffer(1024))).toBe(true)
  })

  it('returns false for non-PE input', () => {
    expect(hasPeAuthenticodeSignatureInBuffer(Buffer.from('not a pe file'))).toBe(false)
  })
})
