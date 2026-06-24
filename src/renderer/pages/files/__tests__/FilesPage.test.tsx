// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { FileEntry } from '@shared/data/types/file'
import { mockUseInfiniteQuery } from '@test-mocks/renderer/useDataApi'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({
  isMac: true
}))

const ipcMocks = vi.hoisted(() => ({
  request: vi.fn()
}))

vi.mock('@renderer/config/constant', () => ({
  get isMac() {
    return platformState.isMac
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: ipcMocks
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { count?: number }) => options?.count ?? key })
}))

import FilesPage from '../FilesPage'

const entry = {
  id: 'file-1',
  origin: 'internal',
  name: 'report',
  ext: 'md',
  size: 1024,
  createdAt: 1_719_216_000_000,
  updatedAt: 1_719_216_000_000
} as unknown as FileEntry

const imageEntry = {
  id: 'file-image',
  origin: 'internal',
  name: 'photo',
  ext: 'png',
  size: 2048,
  createdAt: 1_719_216_000_000,
  updatedAt: 1_719_216_000_000
} as unknown as FileEntry

const externalEntry = {
  id: 'file-external',
  origin: 'external',
  name: 'external',
  ext: 'txt',
  size: null,
  externalPath: '/tmp/external.txt',
  createdAt: 1_719_216_000_000,
  updatedAt: 1_719_216_000_000
} as unknown as FileEntry

const trashedEntry = {
  id: 'file-trash',
  origin: 'internal',
  name: 'trashed',
  ext: 'txt',
  size: 256,
  deletedAt: 1_719_216_000_000,
  createdAt: 1_719_216_000_000,
  updatedAt: 1_719_216_000_000
} as unknown as FileEntry

function mockFiles(entries: FileEntry[]) {
  mockUseInfiniteQuery.mockImplementation((_path, options) => ({
    pages: (options?.query as { inTrash?: boolean } | undefined)?.inTrash ? [] : [{ items: entries }],
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    hasNext: false,
    loadNext: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
    mutate: vi.fn().mockResolvedValue(undefined)
  }))
}

function renderFilesPage(entries: FileEntry[] = [entry]) {
  mockFiles(entries)
  return render(<FilesPage />)
}

beforeEach(() => {
  platformState.isMac = true
  ipcMocks.request.mockReturnValue(new Promise(() => {}))
  mockFiles([entry])
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('FilesPage keyboard rename', () => {
  it('starts inline rename with Enter for a single selected file on macOS', () => {
    vi.useFakeTimers()
    renderFilesPage()

    fireEvent.click(screen.getByText('report.md'))
    fireEvent.keyDown(document, { key: 'Enter' })

    const input = screen.getByDisplayValue('report.md') as HTMLInputElement

    act(() => {
      vi.runOnlyPendingTimers()
    })

    expect(input).toHaveFocus()
  })

  it('does not start inline rename with Enter outside macOS', () => {
    platformState.isMac = false
    renderFilesPage()

    fireEvent.click(screen.getByText('report.md'))
    fireEvent.keyDown(document, { key: 'Enter' })

    expect(screen.queryByDisplayValue('report.md')).not.toBeInTheDocument()
  })

  it('does not call rename when inline rename value is unchanged', () => {
    renderFilesPage()

    fireEvent.click(screen.getByText('report.md'))
    fireEvent.keyDown(document, { key: 'Enter' })
    fireEvent.blur(screen.getByDisplayValue('report.md'))

    expect(ipcMocks.request).not.toHaveBeenCalledWith('file.rename', expect.anything())
  })

  it('ignores Enter shortcuts from interactive controls', () => {
    renderFilesPage()

    fireEvent.click(screen.getByText('report.md'))
    const typeHeader = screen.getAllByRole('button').find((button) => button.textContent?.includes('files.type'))
    expect(typeHeader).toBeDefined()

    typeHeader?.focus()
    fireEvent.keyDown(typeHeader as HTMLButtonElement, { key: 'Enter' })

    expect(screen.queryByDisplayValue('report.md')).not.toBeInTheDocument()
  })

  it('uses extension sorting for the type column query', async () => {
    renderFilesPage()

    const typeHeader = screen.getAllByRole('button').find((button) => button.textContent?.includes('files.type'))
    expect(typeHeader).toBeDefined()
    fireEvent.click(typeHeader as HTMLButtonElement)

    await waitFor(() => {
      const activeCalls = mockUseInfiniteQuery.mock.calls.filter(
        (call) => !(call[1]?.query as { inTrash?: boolean } | undefined)?.inTrash
      )
      expect(activeCalls.at(-1)?.[1]?.query).toMatchObject({ sortBy: 'ext', sortOrder: 'asc' })
    })
  })

  it('uses server totals for all/trash counts', () => {
    mockUseInfiniteQuery.mockImplementation((_path, options) => {
      const query = options?.query as { inTrash?: boolean } | undefined
      return {
        pages: query?.inTrash ? [{ items: [], total: 4 }] : [{ items: [entry], total: 123 }],
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        hasNext: false,
        loadNext: vi.fn(),
        refresh: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn(),
        mutate: vi.fn().mockResolvedValue(undefined)
      }
    })
    render(<FilesPage />)

    expect(screen.getAllByText('123').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('files.trash'))
    expect(screen.getAllByText('4').length).toBeGreaterThan(0)
  })

  it('keeps current rows visible while the sorted query is loading', () => {
    mockUseInfiniteQuery.mockImplementation((_path, options) => {
      const query = options?.query as { inTrash?: boolean; sortBy?: string } | undefined
      const isSortedRequest = query?.sortBy === 'ext'
      return {
        pages: query?.inTrash || isSortedRequest ? [] : [{ items: [entry] }],
        isLoading: isSortedRequest,
        isRefreshing: isSortedRequest,
        error: undefined,
        hasNext: false,
        loadNext: vi.fn(),
        refresh: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn(),
        mutate: vi.fn().mockResolvedValue(undefined)
      }
    })
    render(<FilesPage />)

    expect(screen.getByText('report.md')).toBeInTheDocument()

    const typeHeader = screen.getAllByRole('button').find((button) => button.textContent?.includes('files.type'))
    expect(typeHeader).toBeDefined()
    fireEvent.click(typeHeader as HTMLButtonElement)

    expect(screen.getByText('report.md')).toBeInTheDocument()
    expect(screen.queryByText('files.empty.no_match_title')).not.toBeInTheDocument()
  })
})

describe('FilesPage file operations', () => {
  beforeEach(() => {
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_physical_paths') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      if (route === 'file.batch_trash') return Promise.resolve({ succeeded: [], failed: [] })
      if (route === 'file.batch_permanent_delete') return Promise.resolve({ succeeded: [], failed: [] })
      if (route === 'file.batch_restore') return Promise.resolve({ succeeded: [], failed: [] })
      if (route === 'file.import_paths') return Promise.resolve({ succeeded: [], failed: [] })
      if (route === 'file.rename') return Promise.resolve({})
      return Promise.resolve(input)
    })
  })

  it('routes mixed active delete to trash internal files and remove external entries', () => {
    renderFilesPage([entry, externalEntry])

    fireEvent.click(screen.getByText('report.md'))
    fireEvent.click(screen.getByText('external.txt'), { ctrlKey: true })
    fireEvent.keyDown(document, { key: 'Delete' })

    expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_trash', { ids: [entry.id] })
    expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_permanent_delete', { ids: [externalEntry.id] })
  })

  it('uses permanent delete in the trash view', () => {
    mockUseInfiniteQuery.mockImplementation((_path, options) => ({
      pages: (options?.query as { inTrash?: boolean } | undefined)?.inTrash ? [{ items: [trashedEntry] }] : [],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      mutate: vi.fn().mockResolvedValue(undefined)
    }))
    render(<FilesPage />)

    fireEvent.click(screen.getByText('files.trash'))
    fireEvent.click(screen.getByText('trashed.txt'))
    fireEvent.keyDown(document, { key: 'Delete' })

    expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_permanent_delete', { ids: [trashedEntry.id] })
  })

  it('restores a trashed file from the context menu', () => {
    mockUseInfiniteQuery.mockImplementation((_path, options) => ({
      pages: (options?.query as { inTrash?: boolean } | undefined)?.inTrash ? [{ items: [trashedEntry] }] : [],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      mutate: vi.fn().mockResolvedValue(undefined)
    }))
    render(<FilesPage />)

    fireEvent.click(screen.getByText('files.trash'))
    fireEvent.contextMenu(screen.getByText('trashed.txt'))
    fireEvent.click(screen.getByText('files.restore'))

    expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_restore', { ids: [trashedEntry.id] })
  })

  it('strips the current extension when renaming inline', async () => {
    renderFilesPage()

    fireEvent.click(screen.getByText('report.md'))
    fireEvent.keyDown(document, { key: 'Enter' })
    const input = screen.getByDisplayValue('report.md')
    fireEvent.change(input, { target: { value: 'summary.md' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(ipcMocks.request).toHaveBeenCalledWith('file.rename', { id: entry.id, newName: 'summary' })
    })
  })

  it('does not rename when stripping the current extension leaves an empty name', () => {
    renderFilesPage()

    fireEvent.click(screen.getByText('report.md'))
    fireEvent.keyDown(document, { key: 'Enter' })
    const input = screen.getByDisplayValue('report.md')
    fireEvent.change(input, { target: { value: '   .md' } })
    fireEvent.blur(input)

    expect(ipcMocks.request).not.toHaveBeenCalledWith('file.rename', expect.anything())
  })

  it('imports dropped files through file.import_paths', async () => {
    const fileApi = window.api.file as typeof window.api.file & { getPathForFile: (file: File) => string }
    fileApi.getPathForFile = vi.fn(() => '/tmp/import.md')
    renderFilesPage()

    fireEvent.drop(screen.getByText('report.md'), {
      dataTransfer: { files: [new File(['content'], 'import.md', { type: 'text/markdown' })] }
    })

    await waitFor(() => {
      expect(ipcMocks.request).toHaveBeenCalledWith('file.import_paths', { paths: ['/tmp/import.md'] })
    })
  })

  it('hides files reported as missing', async () => {
    ipcMocks.request.mockImplementation((route: string) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_physical_paths') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({ [externalEntry.id]: 'missing' })
      return Promise.resolve({})
    })

    renderFilesPage([externalEntry])

    await waitFor(() => {
      expect(screen.queryByText('external.txt')).not.toBeInTheDocument()
    })
  })

  it('requires physical paths before showing image grid previews', () => {
    renderFilesPage([imageEntry])

    fireEvent.click(screen.getByText('files.image'))

    expect(screen.queryByAltText('photo.png')).not.toBeInTheDocument()
  })

  it('keeps image rename inline in the file list', async () => {
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_physical_paths') return Promise.resolve({ [imageEntry.id]: '/tmp/photo.png' })
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      return Promise.resolve(input)
    })

    renderFilesPage([imageEntry])

    fireEvent.contextMenu(await screen.findByText('photo.png'))
    fireEvent.click(screen.getByText('files.rename'))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('photo.png')).toBeInTheDocument()
  })

  it('opens a simple rename dialog for image grid items', async () => {
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_physical_paths') return Promise.resolve({ [imageEntry.id]: '/tmp/photo.png' })
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      if (route === 'file.rename') return Promise.resolve({})
      return Promise.resolve(input)
    })

    renderFilesPage([imageEntry])
    fireEvent.click(screen.getByText('files.image'))

    const image = await screen.findByAltText('photo.png')
    fireEvent.contextMenu(image)
    fireEvent.click(screen.getByText('files.rename'))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('common.rename'), { target: { value: 'renamed.png' } })
    fireEvent.click(screen.getByText('common.save'))

    expect(ipcMocks.request).toHaveBeenCalledWith('file.rename', { id: imageEntry.id, newName: 'renamed' })
  })
})
