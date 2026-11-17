import { type BigIntStats, type Stats } from 'node:fs'
import type * as FsPromises from 'node:fs/promises'
import { type FileHandle, lstat, open } from 'node:fs/promises'
import { Readable } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

import { openReadableFileSnapshot } from '../fs'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return { ...actual, lstat: vi.fn(actual.lstat), open: vi.fn(actual.open) }
})

const FILE_ID = 2n ** 53n
const TARGET = '/snapshot-source' as AbsoluteFilePath

function stats(dev: bigint, ino: bigint, bigint: boolean, size = 5n): Stats | BigIntStats {
  return {
    dev: bigint ? dev : Number(dev),
    ino: bigint ? ino : Number(ino),
    size: bigint ? size : Number(size),
    mtimeMs: bigint ? 1_000n : 1_000,
    isFile: () => true
  } as Stats | BigIntStats
}

function inspectFile(pathDev: bigint, pathIno: bigint, handleDev: bigint, handleIno: bigint, size = 5n): void {
  vi.mocked(lstat).mockImplementation(async (_path: unknown, options?: { bigint?: boolean }) =>
    stats(pathDev, pathIno, options?.bigint === true, size)
  )
  vi.mocked(open).mockResolvedValue({
    stat: async (options?: { bigint?: boolean }) => stats(handleDev, handleIno, options?.bigint === true, size),
    createReadStream: () => Readable.from([Buffer.from('hello')]),
    close: async () => {}
  } as unknown as FileHandle)
}

afterEach(() => vi.restoreAllMocks())

describe('openReadableFileSnapshot file identity', () => {
  it.each(['dev', 'ino'] as const)(
    'rejects a different %s even when the IDs round to the same number',
    async (field) => {
      inspectFile(FILE_ID, FILE_ID, field === 'dev' ? FILE_ID + 1n : FILE_ID, field === 'ino' ? FILE_ID + 1n : FILE_ID)

      await expect(openReadableFileSnapshot(TARGET)).rejects.toThrow(
        'Snapshot source changed before it could be opened'
      )
    }
  )

  it('rejects a file size that cannot be represented as a safe stream length', async () => {
    inspectFile(FILE_ID, FILE_ID, FILE_ID, FILE_ID, FILE_ID + 1n)

    await expect(openReadableFileSnapshot(TARGET)).rejects.toThrow('Snapshot source is too large to read safely')
  })

  it('keeps the existing numeric timestamp normalization at a rounded millisecond boundary', async () => {
    inspectFile(FILE_ID, FILE_ID, FILE_ID, FILE_ID)
    vi.mocked(open).mockResolvedValue({
      stat: async (options?: { bigint?: boolean }) => ({
        ...stats(FILE_ID, FILE_ID, options?.bigint === true),
        mtimeMs: options?.bigint ? 1_700_000_000_123n : 1_700_000_000_124
      }),
      close: async () => {}
    } as unknown as FileHandle)

    const snapshot = await openReadableFileSnapshot(TARGET)
    try {
      expect(snapshot.modifiedAt).toBe(1_700_000_000_124)
      expect(snapshot.dev).toBe(FILE_ID)
      expect(snapshot.ino).toBe(FILE_ID)
    } finally {
      await snapshot.close()
    }
  })

  it('retains exact large identities while keeping stream lengths numeric', async () => {
    inspectFile(FILE_ID + 1n, FILE_ID + 1n, FILE_ID + 1n, FILE_ID + 1n)

    const snapshot = await openReadableFileSnapshot(TARGET)
    try {
      expect(snapshot.dev).toBe(FILE_ID + 1n)
      expect(snapshot.ino).toBe(FILE_ID + 1n)
      expect(snapshot.size).toBe(5)
      const chunks: Buffer[] = []
      for await (const chunk of snapshot.createReadStream()) chunks.push(chunk)
      expect(Buffer.concat(chunks).toString()).toBe('hello')
    } finally {
      await snapshot.close()
    }
  })
})
