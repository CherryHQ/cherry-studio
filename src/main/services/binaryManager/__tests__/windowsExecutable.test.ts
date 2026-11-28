import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { readWindowsExecutableBitness } from '../windowsExecutable'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-pe-bitness-'))
afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

const writeFixture = (name: string, contents: Buffer): string => {
  const filePath = path.join(tempRoot, name)
  fs.writeFileSync(filePath, contents)
  return filePath
}

const E_LFANEW = 0x80
const makePeImage = ({
  machine,
  magic,
  clrRva = 0,
  directoryCount = 16
}: {
  machine: number
  magic: number
  clrRva?: number
  directoryCount?: number
}): Buffer => {
  const image = Buffer.alloc(1024)
  image[0] = 0x4d // 'M'
  image[1] = 0x5a // 'Z'
  image.writeUInt32LE(E_LFANEW, 0x3c)
  const pe = E_LFANEW
  image[pe] = 0x50 // 'P'
  image[pe + 1] = 0x45 // 'E'
  image[pe + 2] = 0x00
  image[pe + 3] = 0x00
  image.writeUInt16LE(machine, pe + 4)
  // Optional header starts at pe + 24; its magic states PE32 vs PE32+.
  image.writeUInt16LE(magic, pe + 24)
  const optionalHeaderSize = magic === 0x20b ? 112 : 96
  image.writeUInt16LE(optionalHeaderSize + 16 * 8, pe + 20)
  image.writeUInt32LE(directoryCount, pe + 24 + optionalHeaderSize - 4)
  image.writeUInt32LE(clrRva, pe + 24 + optionalHeaderSize + 14 * 8)
  return image
}

describe('readWindowsExecutableBitness', () => {
  it('reads a PE32+ amd64 image as 64-bit', async () => {
    const filePath = writeFixture('amd64.exe', makePeImage({ machine: 0x8664, magic: 0x20b }))
    await expect(readWindowsExecutableBitness(filePath)).resolves.toBe(64)
  })

  it('reads a PE32 i386 image as 32-bit', async () => {
    const filePath = writeFixture('i386.exe', makePeImage({ machine: 0x14c, magic: 0x10b }))
    await expect(readWindowsExecutableBitness(filePath)).resolves.toBe(32)
  })

  it('reads a PE32+ arm64 image as 64-bit', async () => {
    const filePath = writeFixture('arm64.exe', makePeImage({ machine: 0xaa64, magic: 0x20b }))
    await expect(readWindowsExecutableBitness(filePath)).resolves.toBe(64)
  })

  it('returns null for an unknown machine', async () => {
    const filePath = writeFixture('unknown.exe', makePeImage({ machine: 0x1234, magic: 0x20b }))
    await expect(readWindowsExecutableBitness(filePath)).resolves.toBeNull()
  })

  it.each([
    [0x14c, 0x10b, 96],
    [0x8664, 0x20b, 112]
  ])('rejects a declared optional header smaller than its fixed part (%i)', async (machine, magic, fixedSize) => {
    const image = makePeImage({ machine, magic })
    image.writeUInt16LE(fixedSize - 1, E_LFANEW + 20)
    await expect(readWindowsExecutableBitness(writeFixture('short-optional.exe', image))).resolves.toBeNull()
  })

  it('returns null for truncation inside the declared optional header beyond the old read window', async () => {
    const image = makePeImage({ machine: 0x8664, magic: 0x20b })
    const truncated = image.subarray(0, E_LFANEW + 256)
    await expect(readWindowsExecutableBitness(writeFixture('truncated-optional.exe', truncated))).resolves.toBeNull()
  })

  it.each([0, 14])(
    'treats a directory count of %i as native even with undeclared CLR bytes',
    async (directoryCount) => {
      const image = makePeImage({ machine: 0x8664, magic: 0x20b, clrRva: 0x2000, directoryCount })
      image.writeUInt16LE(112 + directoryCount * 8, E_LFANEW + 20)
      await expect(readWindowsExecutableBitness(writeFixture('no-clr.exe', image))).resolves.toBe(64)
    }
  )

  it('returns null when the declared CLR directory lies outside the optional header', async () => {
    const image = makePeImage({ machine: 0x8664, magic: 0x20b, directoryCount: 15 })
    image.writeUInt16LE(112, E_LFANEW + 20)
    await expect(readWindowsExecutableBitness(writeFixture('missing-clr.exe', image))).resolves.toBeNull()
  })

  it('returns null for a .NET assembly (CLR data directory present)', async () => {
    const filePath = writeFixture('managed.exe', makePeImage({ machine: 0x14c, magic: 0x10b, clrRva: 0x2000 }))
    await expect(readWindowsExecutableBitness(filePath)).resolves.toBeNull()
  })

  it('returns null for a non-PE file', async () => {
    const filePath = writeFixture('script.sh', Buffer.from('#!/bin/sh\necho hi\n'))
    await expect(readWindowsExecutableBitness(filePath)).resolves.toBeNull()
  })

  it('returns null for a file truncated below the DOS header', async () => {
    const filePath = writeFixture('truncated.exe', Buffer.alloc(32, 0))
    await expect(readWindowsExecutableBitness(filePath)).resolves.toBeNull()
  })

  it('returns null when e_lfanew does not point at a PE signature', async () => {
    const image = makePeImage({ machine: 0x8664, magic: 0x20b })
    image.writeUInt32LE(0x60, 0x3c) // points at zeros instead of PE\0\0
    const filePath = writeFixture('not-pe.exe', image)
    await expect(readWindowsExecutableBitness(filePath)).resolves.toBeNull()
  })

  it('returns null without throwing for a missing file', async () => {
    await expect(readWindowsExecutableBitness(path.join(tempRoot, 'does-not-exist.exe'))).resolves.toBeNull()
  })

  it('returns null without throwing for an unreadable executable path', async () => {
    await expect(readWindowsExecutableBitness(tempRoot)).resolves.toBeNull()
  })
})
