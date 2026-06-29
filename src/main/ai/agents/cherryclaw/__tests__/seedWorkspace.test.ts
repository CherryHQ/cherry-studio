import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn()
}))

import { mkdir, stat, writeFile } from 'node:fs/promises'

import { seedIdentityTemplates } from '../seedWorkspace'

const mockedMkdir = vi.mocked(mkdir)
const mockedStat = vi.mocked(stat)
const mockedWriteFile = vi.mocked(writeFile)

describe('seedIdentityTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedMkdir.mockResolvedValue(undefined)
    mockedWriteFile.mockResolvedValue(undefined)
  })

  it('creates the memory dir and seeds templates when files do not exist', async () => {
    mockedStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    await seedIdentityTemplates('/workspace')

    // ensureAgentRoot creates the agent root's memory/ subdir recursively.
    expect(mockedMkdir).toHaveBeenCalledWith('/workspace/memory', { recursive: true })

    expect(mockedWriteFile).toHaveBeenCalledTimes(2)
    const writeCalls = mockedWriteFile.mock.calls.map((c) => c[0])
    expect(writeCalls).toContain('/workspace/SOUL.md')
    expect(writeCalls).toContain('/workspace/USER.md')

    // Verify template content
    const soulCall = mockedWriteFile.mock.calls.find((c) => c[0] === '/workspace/SOUL.md')
    expect(soulCall![1]).toContain('# Soul')
    expect(soulCall![1]).toContain('## Personality')

    const userCall = mockedWriteFile.mock.calls.find((c) => c[0] === '/workspace/USER.md')
    expect(userCall![1]).toContain('# User Profile')
    expect(userCall![1]).toContain('## Name')
  })

  it('skips writing files that already exist (idempotent)', async () => {
    mockedStat.mockResolvedValue({ mtimeMs: 1000 } as any)

    await seedIdentityTemplates('/workspace')

    expect(mockedWriteFile).not.toHaveBeenCalled()
  })

  it('writes only missing files', async () => {
    mockedStat.mockImplementation(async (filePath) => {
      const p = typeof filePath === 'string' ? filePath : filePath.toString()
      if (p.includes('SOUL.md')) {
        return { mtimeMs: 1000 } as any
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    await seedIdentityTemplates('/workspace')

    expect(mockedWriteFile).toHaveBeenCalledTimes(1)
    expect(mockedWriteFile.mock.calls[0][0]).toBe('/workspace/USER.md')
  })
})
