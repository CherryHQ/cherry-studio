// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { FileEntryStats } from '@shared/data/api/schemas/files'
import type { FileEntry } from '@shared/data/types/file'
import { IpcError } from '@shared/ipc/errors'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { mockUseInfiniteQuery, mockUseQuery } from '@test-mocks/renderer/useDataApi'
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

function dirnameOf(path: string): string | undefined {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (index <= 0) return undefined
  return path.slice(0, index)
}

function statsForEntries(entries: FileEntry[]): FileEntryStats {
  const extCounts = new Map<string | null, number>()
  const folderCounts = new Map<string, number>()
  let activeTotal = 0
  let trashTotal = 0

  for (const item of entries) {
    const trashed = 'deletedAt' in item && item.deletedAt != null
    if (trashed) {
      trashTotal += 1
      continue
    }

    activeTotal += 1
    extCounts.set(item.ext, (extCounts.get(item.ext) ?? 0) + 1)
    if (item.origin === 'external') {
      const folder = dirnameOf(item.externalPath)
      if (folder) folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1)
    }
  }

  return {
    activeTotal,
    trashTotal,
    extCounts: [...extCounts.entries()].map(([ext, count]) => ({ ext, count })),
    folderCounts: [...folderCounts.entries()].map(([folder, count]) => ({ folder, count }))
  }
}

function mockFileStats(stats: FileEntryStats, refetch = vi.fn().mockResolvedValue(undefined)) {
  mockUseQuery.mockImplementation(() => ({
    data: stats,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch,
    mutate: vi.fn().mockResolvedValue(stats)
  }))
  return refetch
}

function mockFiles(entries: FileEntry[]) {
  mockFileStats(statsForEntries(entries))
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
  window.toast = { error: vi.fn() } as unknown as typeof window.toast
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
    mockFileStats({ activeTotal: 123, trashTotal: 4, extCounts: [], folderCounts: [] })
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

  it('uses stats for type and folder counts before all active pages are loaded', () => {
    mockFileStats({
      activeTotal: 172,
      trashTotal: 0,
      extCounts: [
        { ext: 'blobx', count: 95 },
        { ext: 'md', count: 75 }
      ],
      folderCounts: [{ folder: '/tmp/cherry-target-folder', count: 75 }]
    })
    mockUseInfiniteQuery.mockImplementation((_path, options) => {
      const query = options?.query as { inTrash?: boolean } | undefined
      return {
        pages: query?.inTrash ? [] : [{ items: [entry], total: 172, nextCursor: 'next-page' }],
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        hasNext: !query?.inTrash,
        loadNext: vi.fn(),
        refresh: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn(),
        mutate: vi.fn().mockResolvedValue(undefined)
      }
    })
    render(<FilesPage />)

    expect(screen.getAllByText('172').length).toBeGreaterThan(0)
    expect(screen.getByText('95')).toBeInTheDocument()
    expect(screen.getAllByText('75').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('cherry-target-folder')).toBeInTheDocument()
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

  it('loads another active page when a client-filtered view does not fill the viewport', async () => {
    const loadNext = vi.fn()
    mockUseInfiniteQuery.mockImplementation((_path, options) => {
      const query = options?.query as { inTrash?: boolean } | undefined
      return {
        pages: query?.inTrash ? [] : [{ items: [entry], total: 200, nextCursor: 'next-page' }],
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        hasNext: !query?.inTrash,
        loadNext: query?.inTrash ? vi.fn() : loadNext,
        refresh: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn(),
        mutate: vi.fn().mockResolvedValue(undefined)
      }
    })
    render(<FilesPage />)

    fireEvent.click(screen.getByText('files.text'))

    await waitFor(() => {
      expect(loadNext).toHaveBeenCalledTimes(1)
    })
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

  it('routes mixed active delete to trash internal files and remove external entries', async () => {
    const refetchStats = vi.fn().mockResolvedValue(undefined)
    mockFiles([entry, externalEntry])
    mockFileStats(statsForEntries([entry, externalEntry]), refetchStats)
    render(<FilesPage />)

    fireEvent.click(screen.getByText('report.md'))
    fireEvent.click(screen.getByText('external.txt'), { ctrlKey: true })
    fireEvent.keyDown(document, { key: 'Delete' })

    expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_trash', { ids: [entry.id] })
    expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_permanent_delete', { ids: [externalEntry.id] })
    await waitFor(() => {
      expect(refetchStats).toHaveBeenCalled()
    })
  })

  it('shows a toast when delete partially fails', async () => {
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_physical_paths') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      if (route === 'file.batch_trash') {
        return Promise.resolve({ succeeded: [], failed: [{ id: entry.id, error: 'denied' }] })
      }
      return Promise.resolve(input)
    })
    renderFilesPage()

    fireEvent.click(screen.getByText('report.md'))
    fireEvent.keyDown(document, { key: 'Delete' })

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('files.error.delete_partial_failed')
    })
  })

  it('shows one partial-failure toast for mixed-origin delete failures', async () => {
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_physical_paths') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      if (route === 'file.batch_trash') {
        return Promise.resolve({ succeeded: [], failed: [{ id: entry.id, error: 'trash denied' }] })
      }
      if (route === 'file.batch_permanent_delete') {
        return Promise.resolve({ succeeded: [], failed: [{ id: externalEntry.id, error: 'remove denied' }] })
      }
      return Promise.resolve(input)
    })
    renderFilesPage([entry, externalEntry])

    fireEvent.click(screen.getByText('report.md'))
    fireEvent.click(screen.getByText('external.txt'), { ctrlKey: true })
    fireEvent.keyDown(document, { key: 'Delete' })

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledTimes(1)
      expect(window.toast.error).toHaveBeenCalledWith('files.error.delete_partial_failed')
    })
  })

  it('shows a toast when delete rejects', async () => {
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_physical_paths') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      if (route === 'file.batch_trash') return Promise.reject(new Error('delete failed'))
      return Promise.resolve(input)
    })
    renderFilesPage()

    fireEvent.click(screen.getByText('report.md'))
    fireEvent.keyDown(document, { key: 'Delete' })

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('files.error.delete_failed')
    })
  })

  it('confirms before permanent delete in the trash view', async () => {
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

    expect(ipcMocks.request).not.toHaveBeenCalledWith('file.batch_permanent_delete', { ids: [trashedEntry.id] })
    expect(screen.getByText('files.permanent_delete_confirm.title')).toBeInTheDocument()

    fireEvent.click(screen.getByText('files.permanent_delete'))

    await waitFor(() => {
      expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_permanent_delete', { ids: [trashedEntry.id] })
    })
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

  it('falls back to show in folder when default-open is blocked as unsafe', async () => {
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_physical_paths') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      if (route === 'file.open') return Promise.reject(new IpcError(fileErrorCodes.OPEN_BLOCKED_UNSAFE_TYPE))
      if (route === 'file.show_in_folder') return Promise.resolve(undefined)
      return Promise.resolve(input)
    })
    renderFilesPage()

    fireEvent.doubleClick(screen.getByText('report.md'))

    await waitFor(() => {
      expect(ipcMocks.request).toHaveBeenCalledWith('file.show_in_folder', { id: entry.id })
    })
  })

  it('imports dropped files through file.import_paths', async () => {
    const refetchStats = vi.fn().mockResolvedValue(undefined)
    const fileApi = window.api.file as typeof window.api.file & { getPathForFile: (file: File) => string }
    fileApi.getPathForFile = vi.fn(() => '/tmp/import.md')
    mockFiles([entry])
    mockFileStats(statsForEntries([entry]), refetchStats)
    render(<FilesPage />)

    fireEvent.drop(screen.getByText('report.md'), {
      dataTransfer: { files: [new File(['content'], 'import.md', { type: 'text/markdown' })] }
    })

    await waitFor(() => {
      expect(ipcMocks.request).toHaveBeenCalledWith('file.import_paths', { paths: ['/tmp/import.md'] })
      expect(refetchStats).toHaveBeenCalled()
    })
  })

  it('shows a toast when import partially fails', async () => {
    const fileApi = window.api.file as typeof window.api.file & { getPathForFile: (file: File) => string }
    fileApi.getPathForFile = vi.fn(() => '/tmp/import.md')
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_physical_paths') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      if (route === 'file.import_paths') {
        return Promise.resolve({ succeeded: [], failed: [{ sourceRef: '/tmp/import.md', error: 'denied' }] })
      }
      return Promise.resolve(input)
    })
    renderFilesPage()

    fireEvent.drop(screen.getByText('report.md'), {
      dataTransfer: { files: [new File(['content'], 'import.md', { type: 'text/markdown' })] }
    })

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('files.error.import_partial_failed')
    })
  })

  it('keeps missing external files visible so they can be removed from the library', async () => {
    ipcMocks.request.mockImplementation((route: string) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_physical_paths') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({ [externalEntry.id]: 'missing' })
      if (route === 'file.batch_permanent_delete') return Promise.resolve({ succeeded: [externalEntry.id], failed: [] })
      return Promise.resolve({})
    })

    renderFilesPage([externalEntry])

    expect(await screen.findByText('external.txt')).toBeInTheDocument()
    expect(screen.getByText('files.missing')).toBeInTheDocument()

    fireEvent.contextMenu(screen.getByText('external.txt'))
    fireEvent.click(screen.getByText('files.remove_from_library'))

    await waitFor(() => {
      expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_permanent_delete', { ids: [externalEntry.id] })
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
