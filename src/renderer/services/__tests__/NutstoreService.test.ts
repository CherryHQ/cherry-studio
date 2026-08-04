import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getPreference, backupToWebdav, listWebdavFiles, deleteWebdavFile, decryptToken, request } = vi.hoisted(() => ({
  getPreference: vi.fn(),
  backupToWebdav: vi.fn(),
  listWebdavFiles: vi.fn(),
  deleteWebdavFile: vi.fn(),
  decryptToken: vi.fn(),
  request: vi.fn()
}))

vi.mock('@data/PreferenceService', () => ({ preferenceService: { get: getPreference } }))
vi.mock('@renderer/i18n/resolver', () => ({ default: { t: (key: string) => key } }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('@renderer/services/popup', () => ({ popup: { confirm: vi.fn() } }))
vi.mock('@renderer/services/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { backupToNutstore } = await import('../NutstoreService')

const PREFERENCES: Record<string, unknown> = {
  'data.backup.nutstore.token': 'token',
  'data.backup.nutstore.path': '/cherry',
  'data.backup.nutstore.skip_backup_file': false,
  'data.backup.nutstore.max_backups': 1
}

function existingBackups(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    fileName: `cherry-studio.2026010${i}000000.mac.zip`,
    basename: `cherry-studio.2026010${i}000000.mac.zip`,
    modifiedTime: `2026-01-0${i + 1}T00:00:00Z`
  }))
}

describe('backupToNutstore rotation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPreference.mockImplementation(async (key: string) => PREFERENCES[key])
    decryptToken.mockResolvedValue({ username: 'u', access_token: 'a' })
    request.mockResolvedValue('mac')
    listWebdavFiles.mockResolvedValue(existingBackups(2))
    deleteWebdavFile.mockResolvedValue(true)
    vi.stubGlobal('window', {
      api: {
        nutstore: { decryptToken },
        backup: { backupToWebdav, listWebdavFiles, deleteWebdavFile }
      }
    })
  })

  // With max_backups = 1 the pre-upload prune deleted every existing archive, so
  // a failed upload left the user with nothing.
  it('keeps every existing backup when the upload fails', async () => {
    backupToWebdav.mockResolvedValue(false)

    await backupToNutstore()

    expect(deleteWebdavFile).not.toHaveBeenCalled()
  })

  it('keeps every existing backup when the upload throws', async () => {
    backupToWebdav.mockRejectedValue(new Error('network down'))

    await backupToNutstore()

    expect(deleteWebdavFile).not.toHaveBeenCalled()
  })

  it('prunes down to max_backups only after the upload lands', async () => {
    backupToWebdav.mockResolvedValue(true)

    await backupToNutstore()

    expect(backupToWebdav).toHaveBeenCalledBefore(deleteWebdavFile)
    // Two listed, keeping one: the older of the pair goes.
    expect(deleteWebdavFile).toHaveBeenCalledOnce()
    expect(deleteWebdavFile).toHaveBeenCalledWith('cherry-studio.20260100000000.mac.zip', expect.anything())
  })
})
