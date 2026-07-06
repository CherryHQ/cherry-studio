/** 手工构造 ZIP 字节的测试工具:可伪造中央目录里的 uncompressedSize 等字段,用于预检超限用例 */

export interface TestZipEntry {
  name: string
  content?: Uint8Array
  compressedSize?: number
  uncompressedSize?: number
}

export function asciiBytes(value: string): Uint8Array {
  return Uint8Array.from(value, (char) => char.charCodeAt(0))
}

function concatBytes(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0))
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}

export function createZipBytes(entries: TestZipEntry[]): Uint8Array<ArrayBuffer> {
  const localRecords: Uint8Array[] = []
  const centralRecords: Uint8Array[] = []
  let localOffset = 0

  for (const entry of entries) {
    const name = asciiBytes(entry.name)
    const content = entry.content ?? new Uint8Array()
    const compressedSize = entry.compressedSize ?? content.byteLength
    const uncompressedSize = entry.uncompressedSize ?? content.byteLength

    const localRecord = new Uint8Array(30 + name.byteLength + content.byteLength)
    const localView = new DataView(localRecord.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint32(18, compressedSize, true)
    localView.setUint32(22, uncompressedSize, true)
    localView.setUint16(26, name.byteLength, true)
    localRecord.set(name, 30)
    localRecord.set(content, 30 + name.byteLength)

    const centralRecord = new Uint8Array(46 + name.byteLength)
    const centralView = new DataView(centralRecord.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint32(20, compressedSize, true)
    centralView.setUint32(24, uncompressedSize, true)
    centralView.setUint16(28, name.byteLength, true)
    centralView.setUint32(42, localOffset, true)
    centralRecord.set(name, 46)

    localRecords.push(localRecord)
    centralRecords.push(centralRecord)
    localOffset += localRecord.byteLength
  }

  const centralDirectoryOffset = localOffset
  const centralDirectorySize = centralRecords.reduce((size, record) => size + record.byteLength, 0)
  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, 0x06054b50, true)
  eocdView.setUint16(8, entries.length, true)
  eocdView.setUint16(10, entries.length, true)
  eocdView.setUint32(12, centralDirectorySize, true)
  eocdView.setUint32(16, centralDirectoryOffset, true)

  return concatBytes([...localRecords, ...centralRecords, eocd])
}
