import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn()
}))

import { readFile } from 'node:fs/promises'

import { HeartbeatReader } from '../heartbeat'

const mockedReadFile = vi.mocked(readFile)

describe('HeartbeatReader', () => {
  let reader: HeartbeatReader

  beforeEach(() => {
    reader = new HeartbeatReader()
    vi.clearAllMocks()
  })

  it('returns content when file exists', async () => {
    mockedReadFile.mockResolvedValue('heartbeat content')

    const result = await reader.readHeartbeat('/workspace')

    expect(result).toBe('heartbeat content')
    expect(mockedReadFile).toHaveBeenCalledWith(expect.stringContaining('heartbeat.md'), 'utf-8')
  })

  it('returns undefined when file does not exist', async () => {
    mockedReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const result = await reader.readHeartbeat('/workspace')

    expect(result).toBeUndefined()
  })

  it('returns undefined when file is empty', async () => {
    mockedReadFile.mockResolvedValue('   \n  ')

    const result = await reader.readHeartbeat('/workspace')

    expect(result).toBeUndefined()
  })

  it('trims whitespace from content', async () => {
    mockedReadFile.mockResolvedValue('  check my email  \n')

    const result = await reader.readHeartbeat('/workspace')

    expect(result).toBe('check my email')
  })
})
