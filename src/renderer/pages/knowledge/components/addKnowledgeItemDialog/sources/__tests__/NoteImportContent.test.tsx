import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = {
  ipcRequest: vi.fn(),
  validateNotesDirectory: vi.fn()
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: unknown[]) => mocks.ipcRequest(...args)
  }
}))

let syncedPrefPath: string | null
let devicePath: string | null
let capturedRootPath: string | undefined

vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({ notesPath: syncedPrefPath })
}))

vi.mock('@renderer/hooks/useDirectoryTree', () => ({
  useDirectoryTree: (rootPath?: string) => {
    capturedRootPath = rootPath
    return { root: null, isLoading: false, error: null }
  }
}))

const NoteImportContent = (await import('../NoteImportContent')).default

const dialogProps = { selectedNotes: [], onToggle: vi.fn(), onSelectionChange: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  syncedPrefPath = 'E:/Foreign'
  devicePath = null
  capturedRootPath = undefined
  Object.assign(window, {
    api: { file: { validateNotesDirectory: mocks.validateNotesDirectory } }
  })
  mocks.ipcRequest.mockImplementation((route: string) => {
    if (route === 'app.get_info') return Promise.resolve({ notesPath: '/default-notes' })
    if (route === 'file.notes.get_device_path') return Promise.resolve(devicePath)
    if (route === 'file.notes.set_device_path') return Promise.resolve(undefined)
    return Promise.resolve(true)
  })
  mocks.validateNotesDirectory.mockResolvedValue(true)
})

describe('NoteImportContent device path', () => {
  it('lists this PC’s Notes folder instead of the foreign synced pref', async () => {
    devicePath = 'D:\\Notes'
    render(<NoteImportContent {...dialogProps} />)

    await waitFor(() => expect(capturedRootPath).toBe('D:/Notes'))
    expect(await screen.findByText('knowledge.data_source.add_dialog.note.empty_title')).toBeInTheDocument()
  })

  it('falls back to the synced pref when nothing was stamped on this PC', async () => {
    render(<NoteImportContent {...dialogProps} />)

    await waitFor(() => expect(capturedRootPath).toBe('E:/Foreign'))
  })
})
