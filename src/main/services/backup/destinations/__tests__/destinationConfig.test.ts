import { beforeEach, describe, expect, it, vi } from 'vitest'

const USER_DATA = '/home/u/.config/CherryStudio'
const INSTALL = '/opt/cherry-studio'

const { hasWritePermissionMock, isPathInsideMock, preferences } = vi.hoisted(() => ({
  hasWritePermissionMock: vi.fn(),
  isPathInsideMock: vi.fn(),
  preferences: { get: vi.fn() }
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'PreferenceService') return preferences
      throw new Error(`Unexpected service: ${name}`)
    },
    getPath: (key: string) => {
      if (key === 'app.userdata') return USER_DATA
      if (key === 'app.install') return INSTALL
      throw new Error(`Unexpected path key: ${key}`)
    }
  }
}))
vi.mock('@main/services/nutstore/NutstoreService', () => ({ decryptToken: vi.fn() }))
vi.mock('@main/utils/legacyFile', () => ({
  hasWritePermission: hasWritePermissionMock,
  isPathInside: isPathInsideMock
}))

const { resolveDestination } = await import('../destinationConfig')
const { DestinationNotConfiguredError } = await import('../../errors')

beforeEach(() => {
  vi.clearAllMocks()
  preferences.get.mockImplementation((key: string) => {
    if (key === 'data.backup.local.dir') return '/home/u/backups'
    if (key === 'data.backup.local.max_backups') return 5
    return undefined
  })
  isPathInsideMock.mockReturnValue(false)
  hasWritePermissionMock.mockResolvedValue(true)
})

/**
 * The settings page checks a folder when a human picks one. A scheduled backup
 * runs against whatever the preference says now, which is what these cases are
 * about.
 */
describe('resolveDestination — local directory safety', () => {
  it('resolves a directory outside the app that can be written', async () => {
    await expect(resolveDestination('local')).resolves.toEqual({
      kind: 'local',
      dir: '/home/u/backups',
      maxBackups: 5
    })
  })

  // Each archive would land inside the source of the next one.
  it('refuses a directory inside the app data directory', async () => {
    isPathInsideMock.mockImplementation((_child: string, parent: string) => parent === USER_DATA)

    await expect(resolveDestination('local')).rejects.toBeInstanceOf(DestinationNotConfiguredError)
  })

  // An update replaces what lives there.
  it('refuses a directory inside the install directory', async () => {
    isPathInsideMock.mockImplementation((_child: string, parent: string) => parent === INSTALL)

    await expect(resolveDestination('local')).rejects.toBeInstanceOf(DestinationNotConfiguredError)
  })

  // A removable drive that is no longer mounted, or a folder since deleted.
  it('refuses a directory it cannot write to', async () => {
    hasWritePermissionMock.mockResolvedValue(false)

    await expect(resolveDestination('local')).rejects.toBeInstanceOf(DestinationNotConfiguredError)
  })

  it('refuses before touching the filesystem when nothing is configured', async () => {
    preferences.get.mockImplementation((key: string) => (key === 'data.backup.local.dir' ? '' : 5))

    await expect(resolveDestination('local')).rejects.toBeInstanceOf(DestinationNotConfiguredError)
    expect(hasWritePermissionMock).not.toHaveBeenCalled()
  })
})
