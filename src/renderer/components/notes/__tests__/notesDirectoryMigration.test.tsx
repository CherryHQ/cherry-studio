import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock, confirmMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  confirmMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock } }))
vi.mock('@renderer/services/popup', () => ({ popup: { confirm: confirmMock } }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: toastErrorMock, success: toastSuccessMock } }))

import { migrateNotesDirectoryWithUi, normalizeMigrationSourcePath } from '../notesDirectoryMigration'

const t = ((key: string) => key) as never

describe('normalizeMigrationSourcePath', () => {
  // Main compares with node:path.resolve; the renderer helper must agree lexically on absolute paths.
  const posixCases = ['/work/notes', '/work/notes/', '/work/notes//', '/work//notes/./sub/../', '/', '//', '/a\\b/']
  it.each(posixCases)('matches posix path.resolve for %s', (input) => {
    expect(normalizeMigrationSourcePath(input)).toBe(path.posix.resolve(input))
  })

  const winCases = [
    'C:\\notes',
    'C:\\notes\\',
    'C:/notes/',
    'C:\\notes\\\\sub\\.\\',
    'C:\\',
    'C:/',
    'c:\\Notes\\..\\x\\'
  ]
  it.each(winCases)('matches win32 path.resolve for %s modulo separator style', (input) => {
    expect(normalizeMigrationSourcePath(input)).toBe(path.win32.resolve(input).replace(/\\/g, '/'))
  })

  it('treats UNC roots like win32 and keeps the share root', () => {
    expect(normalizeMigrationSourcePath('\\\\server\\share\\notes\\')).toBe('//server/share/notes')
    expect(normalizeMigrationSourcePath('\\\\server\\share\\')).toBe('//server/share/')
  })

  it('does not fold case, follow symlinks or equate different paths', () => {
    expect(normalizeMigrationSourcePath('/work/Notes')).not.toBe(normalizeMigrationSourcePath('/work/notes'))
    expect(normalizeMigrationSourcePath('/work/notes-2/')).not.toBe(normalizeMigrationSourcePath('/work/notes'))
    expect(normalizeMigrationSourcePath('C:/Work')).not.toBe(normalizeMigrationSourcePath('C:/work'))
  })
})

describe('migrateNotesDirectoryWithUi source comparison', () => {
  const targetPath = '/target/notes'

  function mockIpc(authoritativeSource: string) {
    requestMock.mockImplementation(async (route: string) => {
      switch (route) {
        case 'app.notes_relocation.inspect':
          return {
            valid: true,
            source: { markdownFileCount: 1, folderCount: 0, totalBytes: 1 },
            target: { fileCount: 0, markdownFileCount: 0 }
          }
        case 'app.notes_relocation.begin_barrier':
          return { sessionEpoch: 1 }
        case 'app.notes_relocation.resolve_migration_source':
          return { sourcePath: authoritativeSource }
        default:
          return {}
      }
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    confirmMock.mockResolvedValue(true)
  })

  it('migrates a saved source with a trailing separator that main returns normalized', async () => {
    mockIpc('/work/notes')
    const onSuccess = vi.fn()

    await migrateNotesDirectoryWithUi({ t, sourcePath: '/work/notes/', targetPath, onSuccess })

    expect(toastErrorMock).not.toHaveBeenCalled()
    expect(requestMock).toHaveBeenCalledWith('app.notes_relocation.migrate', {
      sourcePath: '/work/notes',
      targetPath,
      merge: false,
      sessionEpoch: 1
    })
    expect(onSuccess).toHaveBeenCalledWith(targetPath)
  })

  it('still rejects a source that really changed', async () => {
    mockIpc('/work/other')
    const onSuccess = vi.fn()

    await migrateNotesDirectoryWithUi({ t, sourcePath: '/work/notes/', targetPath, onSuccess })

    expect(toastErrorMock).toHaveBeenCalledWith('settings.data.notes_relocation.error.source_changed')
    expect(requestMock).not.toHaveBeenCalledWith('app.notes_relocation.migrate', expect.anything())
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
