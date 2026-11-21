import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PopupModule from '@renderer/services/popup'

const { requestMock, confirmMock, toastErrorMock, updateNotesPathMock, selectFolderMock, validateMock } = vi.hoisted(
  () => ({
    requestMock: vi.fn(),
    confirmMock: vi.fn(),
    toastErrorMock: vi.fn(),
    updateNotesPathMock: vi.fn(),
    selectFolderMock: vi.fn(),
    validateMock: vi.fn()
  })
)

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock } }))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({
    notesPath: '/work/notes/',
    updateNotesPath: updateNotesPathMock,
    settings: {},
    updateSettings: vi.fn(),
    sortType: 'nameAsc',
    updateSortType: vi.fn()
  })
}))
vi.mock('@renderer/services/popup', async (importOriginal) => {
  const actual = await importOriginal<typeof PopupModule>()
  return { ...actual, popup: { ...actual.popup, confirm: confirmMock } }
})
vi.mock('@renderer/services/toast', () => ({ toast: { error: toastErrorMock, success: vi.fn(), warning: vi.fn() } }))

import NotesSettings from '../NotesSettings'

describe('NotesSettings migration entry (real migration flow)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { file: { selectFolder: selectFolderMock, validateNotesDirectory: validateMock } }
    })
    selectFolderMock.mockResolvedValue('/target/notes')
    validateMock.mockResolvedValue(true)
    confirmMock.mockResolvedValue(true)
    requestMock.mockImplementation(async (route: string) => {
      switch (route) {
        case 'app.get_info':
          return { notesPath: '/default/notes' }
        case 'app.notes_relocation.inspect':
          return {
            valid: true,
            source: { markdownFileCount: 1, folderCount: 0, totalBytes: 1 },
            target: { fileCount: 0, markdownFileCount: 0 }
          }
        case 'app.notes_relocation.begin_barrier':
          return { sessionEpoch: 1 }
        case 'app.notes_relocation.resolve_migration_source':
          return { sourcePath: '/work/notes' } // main: path.resolve('/work/notes/')
        default:
          return {}
      }
    })
  })

  it('migrates a saved path with a trailing separator instead of aborting source_changed', async () => {
    render(<NotesSettings />)
    fireEvent.click(screen.getByRole('button', { name: /notes\.settings\.data\.select/ }))
    const apply = screen.getByRole('button', { name: 'settings.data.notes_relocation.migrate' })
    await waitFor(() => expect(apply).toBeEnabled())

    fireEvent.click(apply)

    await waitFor(() => expect(updateNotesPathMock).toHaveBeenCalledWith('/target/notes'))
    expect(toastErrorMock).not.toHaveBeenCalled()
    expect(requestMock).toHaveBeenCalledWith(
      'app.notes_relocation.migrate',
      expect.objectContaining({ sourcePath: '/work/notes', targetPath: '/target/notes' })
    )
  })
})
