import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createDirectoryMock, getDirectoryContentsMock, resolveAccountMock } = vi.hoisted(() => ({
  createDirectoryMock: vi.fn(),
  getDirectoryContentsMock: vi.fn(),
  resolveAccountMock: vi.fn()
}))

vi.mock('@main/services/nutstore/NutstoreService', () => ({
  createDirectory: createDirectoryMock,
  getDirectoryContents: getDirectoryContentsMock,
  resolveNutstoreAccount: resolveAccountMock
}))

import { nutstoreHandlers } from '../nutstore'

const ctx = { senderId: 'w1' } as never

beforeEach(() => {
  vi.clearAllMocks()
})

describe('nutstoreHandlers', () => {
  // The whole point of this namespace: the renderer learns who is signed in and
  // nothing more. The channels it replaces handed the access token back out.
  it('answers with the display name only, never the credential', async () => {
    resolveAccountMock.mockResolvedValue({ username: 'someone', userid: 'u1', access_token: 'secret-token' })

    const account = await nutstoreHandlers['nutstore.get_account'](undefined as never, ctx)

    expect(account).toEqual({ username: 'someone' })
    expect(JSON.stringify(account)).not.toContain('secret-token')
  })

  it('answers null when nothing usable is stored', async () => {
    resolveAccountMock.mockResolvedValue(null)

    await expect(nutstoreHandlers['nutstore.get_account'](undefined as never, ctx)).resolves.toBeNull()
  })

  it('takes only a path — the token is read inside main', async () => {
    getDirectoryContentsMock.mockResolvedValue([
      {
        filename: '/cherry-studio/backups',
        basename: 'backups',
        type: 'directory',
        lastmod: '2026-01-01T00:00:00Z',
        size: 0
      }
    ])

    const entries = await nutstoreHandlers['nutstore.list_directory']({ path: '/cherry-studio' }, ctx)

    expect(getDirectoryContentsMock).toHaveBeenCalledExactlyOnceWith('/cherry-studio')
    expect(entries).toEqual([
      {
        path: '/cherry-studio/backups',
        basename: 'backups',
        isDir: true,
        mtime: new Date('2026-01-01T00:00:00Z').valueOf(),
        size: 0
      }
    ])
  })

  it('creates a directory by path alone', async () => {
    await nutstoreHandlers['nutstore.create_directory']({ path: '/cherry-studio/new' }, ctx)

    expect(createDirectoryMock).toHaveBeenCalledExactlyOnceWith('/cherry-studio/new')
  })
})
