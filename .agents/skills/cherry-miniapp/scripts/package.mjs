#!/usr/bin/env node
/**
 * Deterministic packager for a Cherry Studio Mini App directory.
 *
 * Usage: node scripts/package.mjs <appDir> <out.miniapp>
 *
 * Validates the directory first (scripts/validate.mjs), then writes a ZIP
 * whose bytes depend only on the input tree: entries sorted by POSIX path,
 * a fixed DOS timestamp, no extra fields, deflate level 9. Two runs over
 * unchanged input are byte-identical, so the printed SHA-256 and size are
 * the package identity that distribution manifests and validation tokens
 * bind to. Zero dependencies, plain node >= 18.
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { deflateRawSync } from 'node:zlib'

import { validateApp } from './validate.mjs'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

async function walk(dir, base = dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, base, out)
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'))
    else throw new Error(`Refusing special file (symlink, device, fifo or socket): ${full}`)
  }
  return out
}

/** Fixed DOS timestamp (1980-01-01 00:00:00) so the bytes carry no build time. */
const DOS_TIME = 0
const DOS_DATE = (1 << 9) | (1 << 5) | 1 // year 0 (1980), month 1, day 1

export async function packageApp(appDir, outFile) {
  const resolved = path.resolve(appDir)
  const validation = await validateApp(resolved)
  if (!validation.ok) {
    const error = new Error(`Validation failed:\n${validation.issues.map((i) => `  - ${i}`).join('\n')}`)
    error.issues = validation.issues
    throw error
  }

  const names = (await walk(resolved)).sort()
  if (names.length > 2000) throw new Error(`Package has ${names.length} entries; the limit is 2000`)
  // The host installer rejects any root-level '__cherry' entry at extraction; refuse
  // here so a package this script writes is never one the host must turn away.
  const reserved = names.find((name) => name.split('/')[0] === '__cherry')
  if (reserved) throw new Error(`Package must not contain the reserved '__cherry' directory: ${reserved}`)

  const chunks = []
  const central = []
  let offset = 0
  let totalBytes = 0

  for (const name of names) {
    const data = await fs.readFile(path.join(resolved, name))
    totalBytes += data.length
    const nameBytes = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const compressed = deflateRawSync(data, { level: 9 })
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0) // local file header signature
    header.writeUInt16LE(20, 4) // version needed
    header.writeUInt16LE(0x0800, 6) // flags: UTF-8 names
    header.writeUInt16LE(8, 8) // method: deflate
    header.writeUInt16LE(DOS_TIME, 10)
    header.writeUInt16LE(DOS_DATE, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(nameBytes.length, 26)
    header.writeUInt16LE(0, 28) // extra field length
    chunks.push(header, nameBytes, compressed)

    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0) // central directory signature
    record.writeUInt16LE(20, 4) // version made by
    record.writeUInt16LE(20, 6) // version needed
    record.writeUInt16LE(0x0800, 8)
    record.writeUInt16LE(8, 10)
    record.writeUInt16LE(DOS_TIME, 12)
    record.writeUInt16LE(DOS_DATE, 14)
    record.writeUInt32LE(crc, 16)
    record.writeUInt32LE(compressed.length, 20)
    record.writeUInt32LE(data.length, 24)
    record.writeUInt16LE(nameBytes.length, 28)
    record.writeUInt32LE(offset, 42) // local header offset
    central.push(Buffer.concat([record, nameBytes]))
    offset += header.length + nameBytes.length + compressed.length
  }

  if (totalBytes > 100 * 1024 * 1024) throw new Error('Extracted size would exceed the 100 MB limit')

  const centralStart = offset
  const centralDirectory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0) // end of central directory
  end.writeUInt16LE(names.length, 8)
  end.writeUInt16LE(names.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(centralStart, 16)

  const zip = Buffer.concat([...chunks, centralDirectory, end])
  if (zip.length > 50 * 1024 * 1024) throw new Error('Archive exceeds the 50 MB limit')

  await fs.writeFile(outFile, zip)
  return {
    ok: true,
    path: path.resolve(outFile),
    sha256: createHash('sha256').update(zip).digest('hex'),
    sizeBytes: zip.length,
    entries: names.length
  }
}

// argv[1] is a raw filesystem path, import.meta.url a file URL: comparing them
// directly skips the CLI entirely on Windows or in a directory with spaces.
// Normalize the argv side to a URL so the documented `node <script>` invocation
// always enters (and importing the module never does).
const isCliEntry = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isCliEntry) {
  const [appDir, outFile] = process.argv.slice(2)
  if (!appDir || !outFile) {
    console.error('Usage: node scripts/package.mjs <appDir> <out.miniapp>')
    process.exit(2)
  }
  try {
    console.log(JSON.stringify(await packageApp(appDir, outFile)))
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
