import { describe, expect, it } from 'vitest'

import { assertZipLimits, OFFICE_ZIP_LIMITS } from '../zipPreflight'
import { asciiBytes, createZipBytes } from './zipTestBytes'

describe('assertZipLimits', () => {
  it('accepts a bounded ZIP archive', () => {
    const bytes = createZipBytes([{ name: 'word/document.xml', content: asciiBytes('<w:document />') }])

    expect(() => assertZipLimits(bytes, 'DOCX')).not.toThrow()
  })

  it('rejects archives with too many entries', () => {
    const bytes = createZipBytes(
      Array.from({ length: OFFICE_ZIP_LIMITS.maxEntries + 1 }, (_, index) => ({
        name: `word/file-${index}.xml`
      }))
    )

    expect(() => assertZipLimits(bytes, 'DOCX')).toThrow('up to 4000 entries')
  })

  it('rejects oversized uncompressed entries', () => {
    const bytes = createZipBytes([
      {
        name: 'word/document.xml',
        uncompressedSize: OFFICE_ZIP_LIMITS.maxEntryUncompressedBytes + 1
      }
    ])

    expect(() => assertZipLimits(bytes, 'DOCX')).toThrow('ZIP entries up to')
  })

  it('rejects oversized total uncompressed payloads', () => {
    const bytes = createZipBytes(
      Array.from({ length: 9 }, (_, index) => ({
        name: `word/file-${index}.xml`,
        uncompressedSize: OFFICE_ZIP_LIMITS.maxEntryUncompressedBytes
      }))
    )

    expect(() => assertZipLimits(bytes, 'DOCX')).toThrow('total uncompressed bytes')
  })

  it('prefixes errors with the caller-provided format label', () => {
    const bytes = createZipBytes([
      {
        name: 'xl/worksheets/sheet1.xml',
        uncompressedSize: OFFICE_ZIP_LIMITS.maxEntryUncompressedBytes + 1
      }
    ])

    expect(() => assertZipLimits(bytes, 'XLSX')).toThrow(/^XLSX preview supports ZIP entries up to/)
  })
})
