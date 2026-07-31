import { describe, expect, it } from 'vitest'

import { assertDocxZipLimits } from '../docxZipPreflight'

const CENTRAL_FILE_HEADER_BYTES = 46
const END_OF_CENTRAL_DIRECTORY_BYTES = 22
const MAX_ENTRY_UNCOMPRESSED_BYTES = 32 * 1024 * 1024

interface ZipEntryMetadata {
  uncompressedBytes: number
}

function createZipMetadata(entries: ZipEntryMetadata[]): Uint8Array {
  const centralDirectorySize = entries.length * CENTRAL_FILE_HEADER_BYTES
  const bytes = new Uint8Array(centralDirectorySize + END_OF_CENTRAL_DIRECTORY_BYTES)
  const view = new DataView(bytes.buffer)

  entries.forEach((entry, index) => {
    const offset = index * CENTRAL_FILE_HEADER_BYTES
    view.setUint32(offset, 0x02014b50, true)
    view.setUint32(offset + 24, entry.uncompressedBytes, true)
  })

  view.setUint32(centralDirectorySize, 0x06054b50, true)
  view.setUint16(centralDirectorySize + 8, entries.length, true)
  view.setUint16(centralDirectorySize + 10, entries.length, true)
  view.setUint32(centralDirectorySize + 12, centralDirectorySize, true)

  return bytes
}

describe('assertDocxZipLimits', () => {
  it('accepts bounded central-directory metadata', () => {
    const bytes = createZipMetadata([{ uncompressedBytes: 1024 }, { uncompressedBytes: 2048 }])

    expect(() => assertDocxZipLimits(bytes)).not.toThrow()
  })

  it.each([
    {
      name: 'an oversized entry',
      bytes: createZipMetadata([{ uncompressedBytes: MAX_ENTRY_UNCOMPRESSED_BYTES + 1 }]),
      message: /ZIP entries up to/
    },
    {
      name: 'an oversized total after individually bounded entries',
      bytes: createZipMetadata(Array.from({ length: 9 }, () => ({ uncompressedBytes: MAX_ENTRY_UNCOMPRESSED_BYTES }))),
      message: /total uncompressed bytes/
    }
  ])('rejects $name before DOCX rendering', ({ bytes, message }) => {
    expect(() => assertDocxZipLimits(bytes)).toThrow(message)
  })

  it('rejects ZIP64 entry-count markers instead of truncating their limits', () => {
    const bytes = createZipMetadata([])
    const view = new DataView(bytes.buffer)
    view.setUint16(8, 0xffff, true)
    view.setUint16(10, 0xffff, true)

    expect(() => assertDocxZipLimits(bytes)).toThrow(/ZIP64/)
  })

  it('rejects entry counts above the preview limit before walking the directory', () => {
    const bytes = createZipMetadata([])
    const view = new DataView(bytes.buffer)
    view.setUint16(8, 4001, true)
    view.setUint16(10, 4001, true)

    expect(() => assertDocxZipLimits(bytes)).toThrow(/up to 4000 entries/)
  })
})
