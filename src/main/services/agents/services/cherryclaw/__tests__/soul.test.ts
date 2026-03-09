import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  readFile: vi.fn()
}))

import { readFile, stat } from 'node:fs/promises'

import { SoulReader } from '../soul'

const mockedStat = vi.mocked(stat)
const mockedReadFile = vi.mocked(readFile)

describe('SoulReader', () => {
  let reader: SoulReader

  beforeEach(() => {
    reader = new SoulReader()
    vi.clearAllMocks()
  })

  it('returns content when soul.md exists', async () => {
    mockedStat.mockResolvedValue({ mtimeMs: 1000 } as any)
    mockedReadFile.mockResolvedValue('# My Soul')

    const result = await reader.readSoul('/workspace')

    expect(result).toBe('# My Soul')
    expect(mockedReadFile).toHaveBeenCalledOnce()
  })

  it('returns undefined when soul.md does not exist', async () => {
    mockedStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const result = await reader.readSoul('/workspace')

    expect(result).toBeUndefined()
    expect(mockedReadFile).not.toHaveBeenCalled()
  })

  it('serves cached content when mtime is unchanged', async () => {
    mockedStat.mockResolvedValue({ mtimeMs: 1000 } as any)
    mockedReadFile.mockResolvedValue('# Cached Soul')

    await reader.readSoul('/workspace')
    const result = await reader.readSoul('/workspace')

    expect(result).toBe('# Cached Soul')
    expect(mockedReadFile).toHaveBeenCalledOnce()
  })

  it('re-reads file when mtime changes', async () => {
    mockedStat.mockResolvedValueOnce({ mtimeMs: 1000 } as any)
    mockedReadFile.mockResolvedValueOnce('# Old Soul')

    await reader.readSoul('/workspace')

    mockedStat.mockResolvedValueOnce({ mtimeMs: 2000 } as any)
    mockedReadFile.mockResolvedValueOnce('# New Soul')

    const result = await reader.readSoul('/workspace')

    expect(result).toBe('# New Soul')
    expect(mockedReadFile).toHaveBeenCalledTimes(2)
  })
})
