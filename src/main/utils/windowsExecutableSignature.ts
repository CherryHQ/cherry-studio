import fs from 'node:fs'

import { app } from 'electron'

import { isWin } from '@main/core/platform'

const IMAGE_DIRECTORY_ENTRY_SECURITY = 4
const IMAGE_DOS_SIGNATURE = 0x5a4d
const IMAGE_NT_SIGNATURE = 0x00004550
const IMAGE_NT_OPTIONAL_HDR32_MAGIC = 0x10b
const IMAGE_NT_OPTIONAL_HDR64_MAGIC = 0x20b

/**
 * True when the PE file embeds an Authenticode certificate table (signed builds).
 * Does not validate the signature chain; unsigned nightlies have an empty table.
 */
export function hasPeAuthenticodeSignature(filePath: string): boolean {
  const handle = fs.openSync(filePath, 'r')
  try {
    const header = Buffer.alloc(512)
    const bytesRead = fs.readSync(handle, header, 0, header.length, 0)
    return hasPeAuthenticodeSignatureInBuffer(header.subarray(0, bytesRead))
  } finally {
    fs.closeSync(handle)
  }
}

export function hasPeAuthenticodeSignatureInBuffer(buffer: Buffer): boolean {
  if (buffer.length < 0x40 || buffer.readUInt16LE(0) !== IMAGE_DOS_SIGNATURE) {
    return false
  }

  const peOffset = buffer.readUInt32LE(0x3c)
  if (peOffset + 0x18 > buffer.length) {
    return false
  }

  if (buffer.readUInt32LE(peOffset) !== IMAGE_NT_SIGNATURE) {
    return false
  }

  const optionalHeaderOffset = peOffset + 0x18
  const magic = buffer.readUInt16LE(optionalHeaderOffset)
  const dataDirectoryOffset =
    optionalHeaderOffset +
    (magic === IMAGE_NT_OPTIONAL_HDR64_MAGIC ? 0x70 : magic === IMAGE_NT_OPTIONAL_HDR32_MAGIC ? 0x60 : -1)
  if (dataDirectoryOffset < 0) {
    return false
  }

  const securityDirectoryOffset = dataDirectoryOffset + IMAGE_DIRECTORY_ENTRY_SECURITY * 8
  if (securityDirectoryOffset + 8 > buffer.length) {
    return false
  }

  const certificateSize = buffer.readUInt32LE(securityDirectoryOffset + 4)
  return certificateSize > 0
}

let cachedRunningExecutableSigned: boolean | undefined

/** Cached per process; the running executable path does not change after launch. */
export function isRunningWindowsExecutableSigned(): boolean {
  if (!isWin) return false
  if (cachedRunningExecutableSigned === undefined) {
    cachedRunningExecutableSigned = hasPeAuthenticodeSignature(app.getPath('exe'))
  }
  return cachedRunningExecutableSigned
}
