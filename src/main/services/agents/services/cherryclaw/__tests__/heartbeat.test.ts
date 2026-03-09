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
  })

  it('returns undefined when file does not exist', async () => {
    mockedReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const result = await reader.readHeartbeat('/workspace')

    expect(result).toBeUndefined()
  })

  it('uses custom filename', async () => {
    mockedReadFile.mockResolvedValue('custom content')

    const result = await reader.readHeartbeat('/workspace', 'custom.md')

    expect(result).toBe('custom content')
    expect(mockedReadFile).toHaveBeenCalledWith(expect.stringContaining('custom.md'), 'utf-8')
  })

  it('blocks path traversal attempts', async () => {
    const result = await reader.readHeartbeat('/workspace', '../../../etc/passwd')

    expect(result).toBeUndefined()
    expect(mockedReadFile).not.toHaveBeenCalled()
  })

  it('defaults to heartbeat.md', async () => {
    mockedReadFile.mockResolvedValue('default heartbeat')

    await reader.readHeartbeat('/workspace')

    expect(mockedReadFile).toHaveBeenCalledWith(expect.stringContaining('heartbeat.md'), 'utf-8')
  })
})
