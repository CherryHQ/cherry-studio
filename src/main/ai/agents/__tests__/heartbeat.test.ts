import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  open: vi.fn(),
  mkdir: vi.fn()
}))

import { mkdir, open, readFile } from 'node:fs/promises'

import { ensureHeartbeatFile, readHeartbeat } from '../heartbeat'

const mockedReadFile = vi.mocked(readFile)
const mockedOpen = vi.mocked(open)
const mockedMkdir = vi.mocked(mkdir)

const errWithCode = (code: string) => Object.assign(new Error(code), { code })

describe('readHeartbeat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns content when file exists', async () => {
    mockedReadFile.mockResolvedValue('heartbeat content')
    const result = await readHeartbeat('/workspace')
    expect(result).toBe('heartbeat content')
    expect(mockedReadFile).toHaveBeenCalledWith(expect.stringContaining('heartbeat.md'), 'utf-8')
  })

  it('returns undefined when file does not exist', async () => {
    mockedReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const result = await readHeartbeat('/workspace')
    expect(result).toBeUndefined()
  })

  it('returns undefined when file is empty', async () => {
    mockedReadFile.mockResolvedValue('   \n  ')
    const result = await readHeartbeat('/workspace')
    expect(result).toBeUndefined()
  })

  it('returns undefined when file holds only HTML comments (fresh template)', async () => {
    mockedReadFile.mockResolvedValue('<!-- check inbox -->\n<!-- keep it small -->')
    const result = await readHeartbeat('/workspace')
    expect(result).toBeUndefined()
  })

  it('returns undefined when the file holds only an unterminated HTML comment', async () => {
    // A truncated template must not bypass the comments-only gate and fire a
    // model call every tick — the unterminated comment consumes the rest.
    mockedReadFile.mockResolvedValue('<!-- truncated template, never closed')
    const result = await readHeartbeat('/workspace')
    expect(result).toBeUndefined()
  })

  it('returns the full content when comments accompany real entries', async () => {
    mockedReadFile.mockResolvedValue('<!-- template header -->\n- real checklist item')
    const result = await readHeartbeat('/workspace')
    expect(result).toBe('<!-- template header -->\n- real checklist item')
  })

  it('trims whitespace from content', async () => {
    mockedReadFile.mockResolvedValue('  check my email  \n')
    const result = await readHeartbeat('/workspace')
    expect(result).toBe('check my email')
  })
})

describe('ensureHeartbeatFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves without throwing when the retry also hits ENOENT', async () => {
    // The directory vanished between mkdir and open (concurrent remover): a
    // missing file reads as empty, so provisioning skips instead of aborting sync.
    mockedOpen.mockRejectedValueOnce(errWithCode('ENOENT')).mockRejectedValueOnce(errWithCode('ENOENT'))
    mockedMkdir.mockResolvedValue(undefined)

    await expect(ensureHeartbeatFile('/workspace')).resolves.toBeUndefined()
    expect(mockedMkdir).toHaveBeenCalledTimes(1)
  })

  it('wraps a mkdir failure with the workspace path in the message', async () => {
    mockedOpen.mockRejectedValueOnce(errWithCode('ENOENT'))
    mockedMkdir.mockRejectedValueOnce(errWithCode('EACCES'))

    await expect(ensureHeartbeatFile('/workspace')).rejects.toThrow(
      'Cannot recreate workspace directory for heartbeat file'
    )
  })

  it('leaves an existing file untouched', async () => {
    mockedOpen.mockRejectedValueOnce(errWithCode('EEXIST'))

    await expect(ensureHeartbeatFile('/workspace')).resolves.toBeUndefined()
    expect(mockedMkdir).not.toHaveBeenCalled()
  })
})
