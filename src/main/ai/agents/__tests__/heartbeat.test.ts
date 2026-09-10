import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  open: vi.fn(),
  mkdir: vi.fn(),
  lstat: vi.fn(),
  unlink: vi.fn()
}))

import { constants } from 'node:fs'
import { lstat, mkdir, open, unlink } from 'node:fs/promises'

import { ensureHeartbeatFile, readHeartbeat } from '../heartbeat'

const mockedOpen = vi.mocked(open)
const mockedMkdir = vi.mocked(mkdir)
const mockedLstat = vi.mocked(lstat)
const mockedUnlink = vi.mocked(unlink)

const regularFile = () => ({ isFile: () => true, isSymbolicLink: () => false })

const errWithCode = (code: string) => Object.assign(new Error(code), { code })

/** Handle shape readHeartbeat consumes: fstat + readFile + close. */
const readableHandle = (content: string, stat = regularFile()) => ({
  stat: vi.fn().mockResolvedValue(stat),
  readFile: vi.fn().mockResolvedValue(content),
  close: vi.fn().mockResolvedValue(undefined)
})

describe('readHeartbeat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns content when file exists', async () => {
    mockedOpen.mockResolvedValue(readableHandle('heartbeat content') as never)
    const result = await readHeartbeat('/workspace')
    expect(result).toBe('heartbeat content')
  })

  it('opens with O_NOFOLLOW, closing the check-to-read symlink window', async () => {
    // Regression: lstat+readFile let a symlink swapped in between the two
    // calls stream its target into the model prompt; O_NOFOLLOW makes the
    // open itself atomic against the swap.
    mockedOpen.mockResolvedValue(readableHandle('heartbeat content') as never)
    await readHeartbeat('/workspace')
    const [pathArg, flags] = mockedOpen.mock.calls[0]
    expect(String(pathArg)).toContain('heartbeat.md')
    expect((flags as number) & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW)
  })

  it('returns undefined when file does not exist', async () => {
    mockedOpen.mockRejectedValue(errWithCode('ENOENT'))
    const result = await readHeartbeat('/workspace')
    expect(result).toBeUndefined()
  })

  it('refuses to read through a symlink (open rejects with ELOOP)', async () => {
    // A pre-existing heartbeat.md symlink — or one swapped in after the
    // storage check — fails the O_NOFOLLOW open instead of being followed.
    mockedOpen.mockRejectedValue(errWithCode('ELOOP'))

    const result = await readHeartbeat('/workspace')

    expect(result).toBeUndefined()
  })

  it('refuses a non-regular file even when the open succeeds', async () => {
    const handle = readableHandle('x', { isFile: () => false, isSymbolicLink: () => false })
    mockedOpen.mockResolvedValue(handle as never)

    const result = await readHeartbeat('/workspace')

    expect(result).toBeUndefined()
    expect(handle.readFile).not.toHaveBeenCalled()
  })

  it('returns undefined when file is empty', async () => {
    mockedOpen.mockResolvedValue(readableHandle('   \n  ') as never)
    const result = await readHeartbeat('/workspace')
    expect(result).toBeUndefined()
  })

  it('returns undefined when file holds only HTML comments (fresh template)', async () => {
    mockedOpen.mockResolvedValue(readableHandle('<!-- check inbox -->\n<!-- keep it small -->') as never)
    const result = await readHeartbeat('/workspace')
    expect(result).toBeUndefined()
  })

  it('returns undefined when the file holds only an unterminated HTML comment', async () => {
    // A truncated template must not bypass the comments-only gate and fire a
    // model call every tick — the unterminated comment consumes the rest.
    mockedOpen.mockResolvedValue(readableHandle('<!-- truncated template, never closed') as never)
    const result = await readHeartbeat('/workspace')
    expect(result).toBeUndefined()
  })

  it('returns the full content when comments accompany real entries', async () => {
    mockedOpen.mockResolvedValue(readableHandle('<!-- template header -->\n- real checklist item') as never)
    const result = await readHeartbeat('/workspace')
    expect(result).toBe('<!-- template header -->\n- real checklist item')
  })

  it('trims whitespace from content', async () => {
    mockedOpen.mockResolvedValue(readableHandle('  check my email  \n') as never)
    const result = await readHeartbeat('/workspace')
    expect(result).toBe('check my email')
  })
})

describe('ensureHeartbeatFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedLstat.mockResolvedValue(regularFile() as never)
    mockedUnlink.mockResolvedValue(undefined)
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

  it('warns and skips provisioning when a symlink occupies heartbeat.md', async () => {
    mockedOpen.mockRejectedValueOnce(errWithCode('EEXIST'))
    mockedLstat.mockResolvedValue({ isFile: () => false, isSymbolicLink: () => true } as never)

    await expect(ensureHeartbeatFile('/workspace')).resolves.toBeUndefined()
    expect(mockedMkdir).not.toHaveBeenCalled()
  })

  it('unlinks a zero-byte corpse when the template write fails, so the next sync re-provisions', async () => {
    const handle = {
      writeFile: vi.fn().mockRejectedValue(new Error('ENOSPC')),
      close: vi.fn().mockResolvedValue(undefined)
    }
    mockedOpen.mockResolvedValueOnce(handle as never)

    await expect(ensureHeartbeatFile('/workspace')).rejects.toThrow('ENOSPC')
    expect(handle.close).toHaveBeenCalled()
    expect(mockedUnlink).toHaveBeenCalledWith(expect.stringContaining('heartbeat.md'))
  })

  it('does not mask the write error when the corpse unlink also fails', async () => {
    const handle = {
      writeFile: vi.fn().mockRejectedValue(new Error('EIO')),
      close: vi.fn().mockResolvedValue(undefined)
    }
    mockedOpen.mockResolvedValueOnce(handle as never)
    mockedUnlink.mockRejectedValueOnce(new Error('unlink failed'))

    await expect(ensureHeartbeatFile('/workspace')).rejects.toThrow('EIO')
  })
})
