// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { FileEntryStats } from '@shared/data/api/schemas/files'
import type { FileEntry } from '@shared/data/types/file'
import { IpcError } from '@shared/ipc/errors'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { mockUseInfiniteQuery, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({
  isMac: true
}))

const ipcMocks = vi.hoisted(() => ({
  request: vi.fn()
}))

vi.mock('@renderer/utils/platform', () => ({
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

function bulkEntry(origin: 'internal' | 'external', index: number): FileEntry {
  const base = {
    id: `bulk-${origin}-${index}`,
    origin,
    name: `bulk-${origin}-${index}`,
    ext: 'txt',
    createdAt: 1_719_216_000_000 + index,
    updatedAt: 1_719_216_000_000 + index
  }
  if (origin === 'external') {
    return { ...base, size: null, externalPath: `/tmp/bulk-${index}.txt` } as unknown as FileEntry
  }
  return { ...base, size: 1 } as unknown as FileEntry
}

function statsForEntries(entries: FileEntry[]): FileEntryStats {
  const extCounts = new Map<string | null, number>()
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
  }

  return {
    activeTotal,
    trashTotal,
    extCounts: [...extCounts.entries()].map(([ext, count]) => ({ ext, count }))
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

function selectFileAt(index: number) {
  fireEvent.click(screen.getAllByRole('checkbox', { name: 'files.select_file' })[index])
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

    selectFileAt(0)
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

    selectFileAt(0)
    fireEvent.keyDown(document, { key: 'Enter' })

    expect(screen.queryByDisplayValue('report.md')).not.toBeInTheDocument()
  })

  it('does not call rename when inline rename value is unchanged', () => {
    renderFilesPage()

    selectFileAt(0)
    fireEvent.keyDown(document, { key: 'Enter' })
    fireEvent.blur(screen.getByDisplayValue('report.md'))

    expect(ipcMocks.request).not.toHaveBeenCalledWith('file.rename', expect.anything())
  })

  it('ignores Enter shortcuts from interactive controls', () => {
    renderFilesPage()

    selectFileAt(0)
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
    mockFileStats({ activeTotal: 123, trashTotal: 4, extCounts: [] })
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

  it('disables selection controls when the current view has no files', () => {
    mockFileStats({ activeTotal: 0, trashTotal: 0, extCounts: [] })
    mockFiles([])
    render(<FilesPage />)

    expect(screen.getByRole('checkbox', { name: 'files.select_all_short' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'files.select_all_short' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'files.actions' })).toBeDisabled()
  })

  it('uses stats for type counts before all active pages are loaded', () => {
    mockFileStats({
      activeTotal: 170,
      trashTotal: 0,
      extCounts: [
        { ext: 'blobx', count: 95 },
        { ext: 'md', count: 75 }
      ]
    })
    mockUseInfiniteQuery.mockImplementation((_path, options) => {
      const query = options?.query as { inTrash?: boolean } | undefined
      return {
        pages: query?.inTrash ? [] : [{ items: [entry], total: 170, nextCursor: 'next-page' }],
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

    expect(screen.getAllByText('170').length).toBeGreaterThan(0)
    expect(screen.getByText('95')).toBeInTheDocument()
    expect(screen.getByText('75')).toBeInTheDocument()
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
      if (route === 'file.batch_create_internal_entries') return Promise.resolve({ succeeded: [], failed: [] })
      if (route === 'file.rename') return Promise.resolve({})
      return Promise.resolve(input)
    })
  })

  it('routes mixed active delete to trash internal files and remove external entries', async () => {
    const refetchStats = vi.fn().mockResolvedValue(undefined)
    mockFiles([entry, externalEntry])
    mockFileStats(statsForEntries([entry, externalEntry]), refetchStats)
    render(<FilesPage />)

    selectFileAt(0)
    selectFileAt(1)
    fireEvent.keyDown(document, { key: 'Delete' })

    expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_trash', { ids: [entry.id] })
    expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_permanent_delete', { ids: [externalEntry.id] })
    await waitFor(() => {
      expect(refetchStats).toHaveBeenCalled()
    })
  })

  it('imports selected files from the visible upload button', async () => {
    const refetchStats = vi.fn().mockResolvedValue(undefined)
    const fileApi = window.api.file as typeof window.api.file & { select: ReturnType<typeof vi.fn> }
    fileApi.select = vi.fn().mockResolvedValue([{ path: '/tmp/import-from-button.md' }])
    mockFiles([entry])
    mockFileStats(statsForEntries([entry]), refetchStats)
    render(<FilesPage />)

    fireEvent.click(screen.getByText('files.upload'))

    await waitFor(() => {
      expect(fileApi.select).toHaveBeenCalledWith({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'files.all', extensions: ['*'] }]
      })
      expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_create_internal_entries', {
        items: [{ source: 'path', path: '/tmp/import-from-button.md' }]
      })
      expect(refetchStats).toHaveBeenCalled()
    })
  })

  it('hides upload and shows empty trash in the trash view', async () => {
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

    expect(screen.queryByText('files.upload')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('files.empty_trash'))

    expect(screen.getByText('files.permanent_delete_confirm.title')).toBeInTheDocument()
    fireEvent.click(screen.getAllByText('files.empty_trash')[0])

    await waitFor(() => {
      expect(ipcMocks.request).toHaveBeenCalledWith('file.empty_trash')
    })
  })

  it('selects all visible files from the header checkbox and exposes batch delete', async () => {
    const secondEntry = { ...entry, id: 'file-2', name: 'notes' } as unknown as FileEntry
    renderFilesPage([entry, secondEntry])

    fireEvent.click(screen.getByRole('checkbox', { name: 'files.select_all' }))
    fireEvent.click(screen.getByText(/files.delete.label/))

    await waitFor(() => {
      expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_trash', { ids: [entry.id, secondEntry.id] })
    })
  })

  it('does not change selection when opening a row context menu', () => {
    const secondEntry = { ...entry, id: 'file-2', name: 'notes' } as unknown as FileEntry
    renderFilesPage([entry, secondEntry])

    const checkboxes = screen.getAllByRole('checkbox', { name: 'files.select_file' })
    fireEvent.click(checkboxes[0])
    fireEvent.contextMenu(screen.getByText('notes.md'))

    expect(checkboxes[0]).toBeChecked()
    expect(checkboxes[1]).not.toBeChecked()
  })

  it('shows batch actions in the toolbar during multi-select', () => {
    const secondEntry = { ...entry, id: 'file-2', name: 'notes' } as unknown as FileEntry
    renderFilesPage([entry, secondEntry])

    selectFileAt(0)
    selectFileAt(1)

    expect(screen.getByText(/files.delete.label/)).toBeInTheDocument()
  })

  it('starts rename from the visible row action button', () => {
    vi.useFakeTimers()
    renderFilesPage()

    fireEvent.click(screen.getByLabelText('files.rename'))

    const input = screen.getByDisplayValue('report.md') as HTMLInputElement
    act(() => {
      vi.runOnlyPendingTimers()
    })

    expect(input).toHaveFocus()
  })

  it('chunks mixed-origin delete mutations independently by origin', async () => {
    const entries = [
      ...Array.from({ length: 501 }, (_, index) => bulkEntry('internal', index)),
      ...Array.from({ length: 501 }, (_, index) => bulkEntry('external', index))
    ]
    renderFilesPage(entries)

    fireEvent.click(screen.getByRole('checkbox', { name: 'files.select_all' }))
    fireEvent.keyDown(document, { key: 'Delete' })

    await waitFor(() => {
      const trashCalls = ipcMocks.request.mock.calls.filter(([route]) => route === 'file.batch_trash')
      const permanentDeleteCalls = ipcMocks.request.mock.calls.filter(
        ([route]) => route === 'file.batch_permanent_delete'
      )

      expect(trashCalls).toHaveLength(2)
      expect(permanentDeleteCalls).toHaveLength(2)
      expect((trashCalls[0][1] as { ids: string[] }).ids).toHaveLength(500)
      expect((trashCalls[1][1] as { ids: string[] }).ids).toHaveLength(1)
      expect((permanentDeleteCalls[0][1] as { ids: string[] }).ids).toHaveLength(500)
      expect((permanentDeleteCalls[1][1] as { ids: string[] }).ids).toHaveLength(1)
    })
  })

  it('shows a toast when delete partially fails', async () => {
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      if (route === 'file.batch_trash') {
        return Promise.resolve({ succeeded: [], failed: [{ id: entry.id, error: 'denied' }] })
      }
      return Promise.resolve(input)
    })
    renderFilesPage()

    selectFileAt(0)
    fireEvent.keyDown(document, { key: 'Delete' })

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('files.error.delete_partial_failed')
    })
  })

  it('shows one partial-failure toast for mixed-origin delete failures', async () => {
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
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

    selectFileAt(0)
    selectFileAt(1)
    fireEvent.keyDown(document, { key: 'Delete' })

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledTimes(1)
      expect(window.toast.error).toHaveBeenCalledWith('files.error.delete_partial_failed')
    })
  })

  it('shows a toast when delete rejects', async () => {
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      if (route === 'file.batch_trash') return Promise.reject(new Error('delete failed'))
      return Promise.resolve(input)
    })
    renderFilesPage()

    selectFileAt(0)
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
    selectFileAt(0)
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

  it('shows a toast when restore partially fails', async () => {
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      if (route === 'file.batch_restore') {
        return Promise.resolve({ succeeded: [], failed: [{ id: trashedEntry.id, error: 'denied' }] })
      }
      return Promise.resolve(input)
    })
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

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('files.error.restore_partial_failed')
    })
  })

  it('shows a toast when restore rejects', async () => {
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      if (route === 'file.batch_restore') return Promise.reject(new Error('restore failed'))
      return Promise.resolve(input)
    })
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

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('files.error.restore_failed')
    })
  })

  it('strips the current extension when renaming inline', async () => {
    renderFilesPage()

    selectFileAt(0)
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

    selectFileAt(0)
    fireEvent.keyDown(document, { key: 'Enter' })
    const input = screen.getByDisplayValue('report.md')
    fireEvent.change(input, { target: { value: '   .md' } })
    fireEvent.blur(input)

    expect(ipcMocks.request).not.toHaveBeenCalledWith('file.rename', expect.anything())
  })

  it('shows a toast when rename rejects', async () => {
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      if (route === 'file.rename') return Promise.reject(new Error('rename failed'))
      return Promise.resolve(input)
    })
    renderFilesPage()

    selectFileAt(0)
    fireEvent.keyDown(document, { key: 'Enter' })
    const input = screen.getByDisplayValue('report.md')
    fireEvent.change(input, { target: { value: 'summary.md' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('files.error.rename_failed')
    })
  })

  it('falls back to show in folder when default-open is blocked as unsafe', async () => {
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      if (route === 'file.open') return Promise.reject(new IpcError(fileErrorCodes.OPEN_BLOCKED_UNSAFE_TYPE))
      if (route === 'file.show_in_folder') return Promise.resolve(undefined)
      return Promise.resolve(input)
    })
    renderFilesPage()

    fireEvent.doubleClick(screen.getByText('report.md'))

    await waitFor(() => {
      expect(ipcMocks.request).toHaveBeenCalledWith('file.show_in_folder', { kind: 'entry', entryId: entry.id })
    })
  })

  it('imports dropped files through file.batch_create_internal_entries', async () => {
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
      expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_create_internal_entries', {
        items: [{ source: 'path', path: '/tmp/import.md' }]
      })
      expect(refetchStats).toHaveBeenCalled()
    })
  })

  it('cancels native file drops in the trash view without importing', () => {
    const fileApi = window.api.file as typeof window.api.file & { getPathForFile: (file: File) => string }
    fileApi.getPathForFile = vi.fn(() => '/tmp/import.md')
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
    const target = screen.getByText('trashed.txt')
    const file = new File(['content'], 'import.md', { type: 'text/markdown' })
    const dragOverEvent = createEvent.dragOver(target, { dataTransfer: { files: [file] } })
    const dropEvent = createEvent.drop(target, { dataTransfer: { files: [file] } })
    const preventDragOverDefault = vi.spyOn(dragOverEvent, 'preventDefault')
    const preventDropDefault = vi.spyOn(dropEvent, 'preventDefault')

    fireEvent(target, dragOverEvent)
    fireEvent(target, dropEvent)

    expect(preventDragOverDefault).toHaveBeenCalled()
    expect(preventDropDefault).toHaveBeenCalled()
    expect(fileApi.getPathForFile).not.toHaveBeenCalled()
    expect(ipcMocks.request).not.toHaveBeenCalledWith('file.batch_create_internal_entries', expect.anything())
  })

  it('chunks dropped file imports at the create-route batch cap', async () => {
    const fileApi = window.api.file as typeof window.api.file & { getPathForFile: (file: File) => string }
    fileApi.getPathForFile = vi.fn((file: File) => `/tmp/${file.name}`)
    renderFilesPage()

    const files = Array.from(
      { length: 101 },
      (_, index) => new File(['content'], `import-${index}.md`, { type: 'text/markdown' })
    )
    fireEvent.drop(screen.getByText('report.md'), { dataTransfer: { files } })

    await waitFor(() => {
      const createCalls = ipcMocks.request.mock.calls.filter(
        ([route]) => route === 'file.batch_create_internal_entries'
      )
      expect(createCalls).toHaveLength(2)
      expect((createCalls[0][1] as { items: unknown[] }).items).toHaveLength(100)
      expect((createCalls[1][1] as { items: unknown[] }).items).toHaveLength(1)
    })
  })

  it('shows a toast when import partially fails', async () => {
    const fileApi = window.api.file as typeof window.api.file & { getPathForFile: (file: File) => string }
    fileApi.getPathForFile = vi.fn(() => '/tmp/import.md')
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      if (route === 'file.batch_create_internal_entries') {
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

  it('shows a toast when import rejects', async () => {
    const fileApi = window.api.file as typeof window.api.file & { getPathForFile: (file: File) => string }
    fileApi.getPathForFile = vi.fn(() => '/tmp/import.md')
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      if (route === 'file.batch_create_internal_entries') return Promise.reject(new Error('import failed'))
      return Promise.resolve(input)
    })
    renderFilesPage()

    fireEvent.drop(screen.getByText('report.md'), {
      dataTransfer: { files: [new File(['content'], 'import.md', { type: 'text/markdown' })] }
    })

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('files.error.import_failed')
    })
  })

  it('keeps missing external files visible so they can be removed from the library', async () => {
    ipcMocks.request.mockImplementation((route: string) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
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

  it('shows image files in the image grid without view switch or selection controls', async () => {
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_physical_paths') return Promise.resolve({ [imageEntry.id]: '/tmp/photo.png' })
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      return Promise.resolve(input)
    })
    renderFilesPage([imageEntry])

    fireEvent.click(screen.getByText('files.image'))

    expect(screen.queryByLabelText('files.view_list')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('files.view_grid')).not.toBeInTheDocument()
    expect(await screen.findByAltText('photo.png')).toBeInTheDocument()
    expect(screen.queryByLabelText('files.select_all_short')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('files.select_file')).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByAltText('photo.png'))
    expect(screen.queryByText('files.rename')).not.toBeInTheDocument()
  })
})
