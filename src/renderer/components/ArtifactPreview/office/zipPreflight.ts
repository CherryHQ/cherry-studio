const ZIP_EOCD_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50
const ZIP_EOCD_MIN_BYTES = 22
const ZIP_CENTRAL_FILE_HEADER_BYTES = 46
const ZIP_MAX_COMMENT_BYTES = 0xffff
const ZIP_UINT16_MAX = 0xffff
const ZIP_UINT32_MAX = 0xffffffff

const OFFICE_ZIP_MAX_ENTRIES = 4000
const OFFICE_ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES = 32 * 1024 * 1024
const OFFICE_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024

interface OfficeZipLimits {
  maxEntries: number
  maxEntryUncompressedBytes: number
  maxTotalUncompressedBytes: number
}

const OFFICE_ZIP_LIMITS: OfficeZipLimits = {
  maxEntries: OFFICE_ZIP_MAX_ENTRIES,
  maxEntryUncompressedBytes: OFFICE_ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES,
  maxTotalUncompressedBytes: OFFICE_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES
}

function findEndOfCentralDirectory(view: DataView, label: string): number {
  const minOffset = Math.max(0, view.byteLength - ZIP_EOCD_MIN_BYTES - ZIP_MAX_COMMENT_BYTES)

  for (let offset = view.byteLength - ZIP_EOCD_MIN_BYTES; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== ZIP_EOCD_SIGNATURE) continue

    const commentLength = view.getUint16(offset + 20, true)
    if (offset + ZIP_EOCD_MIN_BYTES + commentLength === view.byteLength) return offset
  }

  throw new Error(`${label} preview requires a valid ZIP archive`)
}

function assertNoZip64Uint16Marker(value: number, label: string): void {
  if (value === ZIP_UINT16_MAX) {
    throw new Error(`${label} preview does not support ZIP64 archives`)
  }
}

function assertNoZip64Uint32Marker(value: number, label: string): void {
  if (value === ZIP_UINT32_MAX) {
    throw new Error(`${label} preview does not support ZIP64 archives`)
  }
}

/**
 * OOXML (docx/xlsx/pptx) ZIP central-directory preflight. Before handing bytes to an unzip library, reject zip bombs
 * based on the central directory's declared entry count and uncompressed size. `label` is the user-facing format name,
 * such as 'DOCX' or 'XLSX'.
 */
function assertZipLimits(bytes: Uint8Array, label: string, limits: OfficeZipLimits = OFFICE_ZIP_LIMITS): void {
  if (bytes.byteLength < ZIP_EOCD_MIN_BYTES) {
    throw new Error(`${label} preview requires a valid ZIP archive`)
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocdOffset = findEndOfCentralDirectory(view, label)
  const diskNumber = view.getUint16(eocdOffset + 4, true)
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true)
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true)
  const entryCount = view.getUint16(eocdOffset + 10, true)
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true)
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true)

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error(`${label} preview does not support multi-disk ZIP archives`)
  }

  assertNoZip64Uint16Marker(entryCount, label)
  assertNoZip64Uint32Marker(centralDirectorySize, label)
  assertNoZip64Uint32Marker(centralDirectoryOffset, label)

  if (entryCount > limits.maxEntries) {
    throw new Error(`${label} preview supports ZIP archives with up to ${limits.maxEntries} entries`)
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize
  if (centralDirectoryEnd > eocdOffset || centralDirectoryEnd < centralDirectoryOffset) {
    throw new Error(`${label} preview requires a valid ZIP central directory`)
  }

  let cursor = centralDirectoryOffset
  let totalUncompressedBytes = 0

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + ZIP_CENTRAL_FILE_HEADER_BYTES > centralDirectoryEnd) {
      throw new Error(`${label} preview requires a valid ZIP central directory`)
    }

    if (view.getUint32(cursor, true) !== ZIP_CENTRAL_FILE_HEADER_SIGNATURE) {
      throw new Error(`${label} preview requires a valid ZIP central directory`)
    }

    const compressedBytes = view.getUint32(cursor + 20, true)
    const uncompressedBytes = view.getUint32(cursor + 24, true)
    const fileNameLength = view.getUint16(cursor + 28, true)
    const extraFieldLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const diskStart = view.getUint16(cursor + 34, true)
    const localHeaderOffset = view.getUint32(cursor + 42, true)

    assertNoZip64Uint32Marker(compressedBytes, label)
    assertNoZip64Uint32Marker(uncompressedBytes, label)
    assertNoZip64Uint32Marker(localHeaderOffset, label)

    if (diskStart !== 0) {
      throw new Error(`${label} preview does not support multi-disk ZIP archives`)
    }

    if (uncompressedBytes > limits.maxEntryUncompressedBytes) {
      throw new Error(
        `${label} preview supports ZIP entries up to ${limits.maxEntryUncompressedBytes} uncompressed bytes`
      )
    }

    totalUncompressedBytes += uncompressedBytes
    if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      throw new Error(
        `${label} preview supports ZIP archives up to ${limits.maxTotalUncompressedBytes} total uncompressed bytes`
      )
    }

    cursor += ZIP_CENTRAL_FILE_HEADER_BYTES + fileNameLength + extraFieldLength + commentLength
    if (cursor > centralDirectoryEnd) {
      throw new Error(`${label} preview requires a valid ZIP central directory`)
    }
  }

  if (cursor !== centralDirectoryEnd) {
    throw new Error(`${label} preview requires a valid ZIP central directory`)
  }
}

export { assertZipLimits, OFFICE_ZIP_LIMITS }
