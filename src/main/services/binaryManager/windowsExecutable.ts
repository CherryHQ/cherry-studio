import fsp from 'node:fs/promises'

const DOS_HEADER_SIZE = 0x40
const PE_SIGNATURE_SIZE = 4
const COFF_HEADER_SIZE = 20
const OPTIONAL_HEADER_OFFSET = PE_SIGNATURE_SIZE + COFF_HEADER_SIZE
// Data directories follow the fixed-size part of the optional header: 28 + 68
// bytes for PE32, 24 + 88 for PE32+.
const PE32_OPTIONAL_HEADER_SIZE = 96
const PE32PLUS_OPTIONAL_HEADER_SIZE = 112
const CLR_DATA_DIRECTORY_INDEX = 14
const DATA_DIRECTORY_ENTRY_SIZE = 8

/** Bitness of a PE image, or null when the file is not a readable PE executable. */
export async function readWindowsExecutableBitness(filePath: string): Promise<32 | 64 | null> {
  try {
    const handle = await fsp.open(filePath, 'r')
    try {
      const dosHeader = Buffer.alloc(DOS_HEADER_SIZE)
      if ((await handle.read(dosHeader, 0, DOS_HEADER_SIZE, 0)).bytesRead < DOS_HEADER_SIZE) return null
      if (dosHeader[0] !== 0x4d || dosHeader[1] !== 0x5a) return null
      const peOffset = dosHeader.readUInt32LE(0x3c)

      const peHeader = Buffer.alloc(OPTIONAL_HEADER_OFFSET)
      if ((await handle.read(peHeader, 0, peHeader.length, peOffset)).bytesRead < peHeader.length) return null
      if (peHeader[0] !== 0x50 || peHeader[1] !== 0x45 || peHeader[2] !== 0x00 || peHeader[3] !== 0x00) return null

      const machine = peHeader.readUInt16LE(4)
      const declaredOptionalHeaderSize = peHeader.readUInt16LE(20)
      if (declaredOptionalHeaderSize < 2) return null
      const optionalHeader = Buffer.alloc(declaredOptionalHeaderSize)
      if (
        (await handle.read(optionalHeader, 0, optionalHeader.length, peOffset + OPTIONAL_HEADER_OFFSET)).bytesRead <
        optionalHeader.length
      )
        return null
      const magic = optionalHeader.readUInt16LE(0)
      const isPe32 = machine === 0x14c && magic === 0x10b
      const isPe32Plus = (machine === 0x8664 || machine === 0xaa64) && magic === 0x20b
      if (!isPe32 && !isPe32Plus) return null

      const optionalHeaderSize = isPe32 ? PE32_OPTIONAL_HEADER_SIZE : PE32PLUS_OPTIONAL_HEADER_SIZE
      if (declaredOptionalHeaderSize < optionalHeaderSize) return null
      const directoryCount = optionalHeader.readUInt32LE(optionalHeaderSize - 4)
      // A managed assembly runs on whatever CLR loads it, so its headers carry no native word size.
      if (directoryCount > CLR_DATA_DIRECTORY_INDEX) {
        const clrRvaOffset = optionalHeaderSize + CLR_DATA_DIRECTORY_INDEX * DATA_DIRECTORY_ENTRY_SIZE
        if (declaredOptionalHeaderSize < clrRvaOffset + DATA_DIRECTORY_ENTRY_SIZE) return null
        if (optionalHeader.readUInt32LE(clrRvaOffset) !== 0) return null
      }
      return isPe32 ? 32 : 64
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}
