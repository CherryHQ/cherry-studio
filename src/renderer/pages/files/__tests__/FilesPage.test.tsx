// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import type { FileEntryStats } from '@shared/data/api/schemas/files'
import type { FileEntry } from '@shared/data/types/file'
import { mockUseInfiniteQuery, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({
  isMac: true
}))

const ipcMocks = vi.hoisted(() => ({
  request: vi.fn()
}))

const filePreviewMocks = vi.hoisted(() => ({
  render: vi.fn()
}))

const imagePreviewMocks = vi.hoisted(() => ({
  show: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@renderer/components/FilePreview', () => ({
  FilePreview: ({ header, ...props }: { filePath: string; header?: ReactNode; refreshKey?: number }) => {
    filePreviewMocks.render(props)
    return <div>{header}</div>
  }
}))

vi.mock('@renderer/services/ImagePreviewService', () => ({
  ImagePreviewService: {
    show: imagePreviewMocks.show
  }
}))

const virtualizerMocks = vi.hoisted(() => ({
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
  useVirtualizer: vi.fn(
    (options: { count: number; estimateSize: () => number; getItemKey?: (index: number) => string | number }) => ({
      getTotalSize: () => options.count * options.estimateSize(),
      getVirtualItems: () =>
        Array.from({ length: Math.min(options.count, 20) }, (_, index) => ({
          index,
          key: options.getItemKey?.(index) ?? index,
          size: options.estimateSize(),
          start: index * options.estimateSize()
        })),
      measureElement: virtualizerMocks.measureElement,
      scrollToIndex: virtualizerMocks.scrollToIndex
    })
  )
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: virtualizerMocks.useVirtualizer
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

const trashedImageEntry = {
  ...imageEntry,
  id: 'file-trash-image',
  name: 'trashed-photo',
  deletedAt: 1_719_216_000_000
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
  const activePages = [{ items: entries }]
  const trashedPages: Array<{ items: FileEntry[] }> = []
  const loadNext = vi.fn()
  const refresh = vi.fn().mockResolvedValue(undefined)
  const reset = vi.fn()
  const mutate = vi.fn().mockResolvedValue(undefined)
  mockUseInfiniteQuery.mockImplementation((_path, options) => ({
    pages: (options?.query as { inTrash?: boolean } | undefined)?.inTrash ? trashedPages : activePages,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    hasNext: false,
    loadNext,
    refresh,
    reset,
    mutate
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
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('FilesPage visible-view hydration', () => {
  it('enables and hydrates only the visible file query', async () => {
    mockFileStats(statsForEntries([imageEntry, trashedImageEntry]))
    ipcMocks.request.mockResolvedValue({})
    const activeResult = {
      pages: [{ items: [imageEntry] }],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      mutate: vi.fn().mockResolvedValue(undefined)
    }
    const trashResult = {
      ...activeResult,
      pages: [{ items: [trashedImageEntry] }],
      loadNext: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      mutate: vi.fn().mockResolvedValue(undefined)
    }
    mockUseInfiniteQuery.mockImplementation((_path, options) => {
      const inTrash = Boolean((options?.query as { inTrash?: boolean } | undefined)?.inTrash)
      return inTrash ? trashResult : activeResult
    })

    render(<FilesPage />)

    await waitFor(() => {
      const activeCall = mockUseInfiniteQuery.mock.calls
        .filter((call) => !(call[1]?.query as { inTrash?: boolean } | undefined)?.inTrash)
        .at(-1)
      const trashCall = mockUseInfiniteQuery.mock.calls
        .filter((call) => (call[1]?.query as { inTrash?: boolean } | undefined)?.inTrash)
        .at(-1)
      expect(activeCall?.[1]?.enabled).toBe(true)
      expect(trashCall?.[1]?.enabled).toBe(false)
      expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_get_metadata', {
        items: [{ key: imageEntry.id, handle: { kind: 'entry', entryId: imageEntry.id } }]
      })
      expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_get_physical_paths', { ids: [imageEntry.id] })
      expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_get_dangling_states', { ids: [imageEntry.id] })
    })
    expect(ipcMocks.request).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ids: expect.arrayContaining([trashedImageEntry.id]) })
    )
    expect(ipcMocks.request).not.toHaveBeenCalledWith('file.batch_get_metadata', {
      items: expect.arrayContaining([expect.objectContaining({ key: trashedImageEntry.id })])
    })

    ipcMocks.request.mockClear()
    fireEvent.click(screen.getByText('files.trash'))

    await waitFor(() => {
      const activeCall = mockUseInfiniteQuery.mock.calls
        .filter((call) => !(call[1]?.query as { inTrash?: boolean } | undefined)?.inTrash)
        .at(-1)
      const trashCall = mockUseInfiniteQuery.mock.calls
        .filter((call) => (call[1]?.query as { inTrash?: boolean } | undefined)?.inTrash)
        .at(-1)
      expect(activeCall?.[1]?.enabled).toBe(false)
      expect(trashCall?.[1]?.enabled).toBe(true)
      expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_get_metadata', {
        items: [{ key: trashedImageEntry.id, handle: { kind: 'entry', entryId: trashedImageEntry.id } }]
      })
      expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_get_physical_paths', {
        ids: [trashedImageEntry.id]
      })
      expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_get_dangling_states', {
        ids: [trashedImageEntry.id]
      })
    })
    expect(ipcMocks.request).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ids: expect.arrayContaining([imageEntry.id]) })
    )
    expect(ipcMocks.request).not.toHaveBeenCalledWith('file.batch_get_metadata', {
      items: expect.arrayContaining([expect.objectContaining({ key: imageEntry.id })])
    })
  })

  it('does not reuse active rows while the trash query is loading', () => {
    mockFileStats(statsForEntries([entry]))
    const activeResult = {
      pages: [{ items: [entry] }],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      mutate: vi.fn().mockResolvedValue(undefined)
    }
    const trashResult = {
      ...activeResult,
      pages: [],
      isLoading: true,
      isRefreshing: true,
      loadNext: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      mutate: vi.fn().mockResolvedValue(undefined)
    }
    mockUseInfiniteQuery.mockImplementation((_path, options) => {
      const inTrash = Boolean((options?.query as { inTrash?: boolean } | undefined)?.inTrash)
      return inTrash ? trashResult : activeResult
    })

    render(<FilesPage />)
    expect(screen.getByText('report.md')).toBeInTheDocument()

    fireEvent.click(screen.getByText('files.trash'))

    expect(screen.queryByText('report.md')).not.toBeInTheDocument()
    expect(screen.getByText('common.loading')).toBeInTheDocument()
  })

  it('ignores active hydration that resolves after switching to trash', async () => {
    mockFileStats(statsForEntries([imageEntry, trashedImageEntry]))
    const activeResult = {
      pages: [{ items: [imageEntry] }],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      mutate: vi.fn().mockResolvedValue(undefined)
    }
    const trashResult = {
      ...activeResult,
      pages: [{ items: [trashedImageEntry] }],
      loadNext: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      mutate: vi.fn().mockResolvedValue(undefined)
    }
    mockUseInfiniteQuery.mockImplementation((_path, options) =>
      (options?.query as { inTrash?: boolean } | undefined)?.inTrash ? trashResult : activeResult
    )

    let resolveActiveMetadata!: (value: Record<string, unknown>) => void
    let resolveActivePhysicalPaths!: (value: Record<string, unknown>) => void
    let resolveActiveDanglingStates!: (value: Record<string, unknown>) => void
    const activeMetadata = new Promise<Record<string, unknown>>((resolve) => {
      resolveActiveMetadata = resolve
    })
    const activePhysicalPaths = new Promise<Record<string, unknown>>((resolve) => {
      resolveActivePhysicalPaths = resolve
    })
    const activeDanglingStates = new Promise<Record<string, unknown>>((resolve) => {
      resolveActiveDanglingStates = resolve
    })
    ipcMocks.request.mockImplementation((route: string, input: { items?: Array<{ key: string }>; ids?: string[] }) => {
      const ids = route === 'file.batch_get_metadata' ? (input.items?.map((item) => item.key) ?? []) : (input.ids ?? [])
      const isActiveRequest = ids.includes(imageEntry.id)
      if (isActiveRequest && route === 'file.batch_get_metadata') return activeMetadata
      if (isActiveRequest && route === 'file.batch_get_physical_paths') return activePhysicalPaths
      if (isActiveRequest && route === 'file.batch_get_dangling_states') return activeDanglingStates
      if (route === 'file.batch_get_metadata') {
        return Promise.resolve({
          [trashedImageEntry.id]: {
            size: 2048,
            createdAt: Date.UTC(2030, 0, 2),
            modifiedAt: Date.UTC(2030, 0, 2)
          }
        })
      }
      if (route === 'file.batch_get_physical_paths') {
        return Promise.resolve({ [trashedImageEntry.id]: '/tmp/trashed-photo.png' })
      }
      return Promise.resolve({})
    })

    render(<FilesPage />)
    await waitFor(() => {
      expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_get_dangling_states', { ids: [imageEntry.id] })
    })

    fireEvent.click(screen.getByText('files.trash'))
    await waitFor(() => expect(screen.getAllByText(/^2030-/).length).toBeGreaterThan(0))

    act(() => {
      resolveActiveMetadata({
        [imageEntry.id]: { size: 2048, createdAt: Date.UTC(2040, 0, 2), modifiedAt: Date.UTC(2040, 0, 2) }
      })
      resolveActivePhysicalPaths({ [imageEntry.id]: '/tmp/photo.png' })
      resolveActiveDanglingStates({})
    })

    await waitFor(() => {
      expect(screen.getAllByText(/^2030-/).length).toBeGreaterThan(0)
      expect(screen.queryByText(/^2040-/)).not.toBeInTheDocument()
    })
  })
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

  it('does not start inline rename for a missing selected file', async () => {
    ipcMocks.request.mockImplementation((route: string) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({ [externalEntry.id]: 'missing' })
      return Promise.resolve({})
    })
    renderFilesPage([externalEntry])

    expect(await screen.findByText('files.missing')).toBeInTheDocument()
    selectFileAt(0)
    fireEvent.keyDown(document, { key: 'F2' })

    expect(screen.queryByDisplayValue('external.txt')).not.toBeInTheDocument()
  })

  it('does not start inline rename for a selected trash file', () => {
    mockFileStats(statsForEntries([trashedEntry]))
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
    fireEvent.keyDown(document, { key: 'Enter' })

    expect(screen.queryByDisplayValue('trashed.txt')).not.toBeInTheDocument()
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

  it('handles file shortcuts from a focused selection checkbox', async () => {
    renderFilesPage()

    const checkbox = screen.getByRole('checkbox', { name: 'files.select_file' })
    fireEvent.click(checkbox)
    checkbox.focus()
    fireEvent.keyDown(checkbox, { key: 'Delete' })

    await waitFor(() => {
      expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_trash', { ids: [entry.id] })
    })
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

  it('hides the contextual selection toolbar when nothing is selected', () => {
    mockFileStats({ activeTotal: 0, trashTotal: 0, extCounts: [] })
    mockFiles([])
    render(<FilesPage />)

    expect(screen.queryByRole('button', { name: 'files.actions' })).not.toBeInTheDocument()
  })

  it('shows the unified empty state once the file list loads empty', () => {
    mockFileStats({ activeTotal: 0, trashTotal: 0, extCounts: [] })
    mockFiles([])
    render(<FilesPage />)

    expect(screen.getByText('files.empty.title')).toBeInTheDocument()
    expect(screen.queryByText('files.empty.no_match_title')).toBeNull()
  })

  it('shows a single message when the current file filter has no matches', () => {
    mockFiles([entry])
    render(<FilesPage />)

    fireEvent.click(screen.getByText('files.image'))

    expect(screen.getByText('files.empty.no_match_title')).toBeInTheDocument()
    expect(screen.queryByText('files.empty.no_match_description')).not.toBeInTheDocument()
  })

  it('shows loading feedback instead of an empty state while the file list is loading', () => {
    mockFileStats({ activeTotal: 0, trashTotal: 0, extCounts: [] })
    mockUseInfiniteQuery.mockImplementation(() => ({
      pages: [],
      isLoading: true,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      mutate: vi.fn().mockResolvedValue(undefined)
    }))
    render(<FilesPage />)

    expect(screen.getByText('common.loading')).toBeInTheDocument()
    expect(screen.queryByText('files.empty.title')).toBeNull()
    expect(screen.queryByText('files.empty.no_match_title')).toBeNull()
  })

  it('uses stats for library and type counts before all active pages are loaded', () => {
    mockFileStats({
      activeTotal: 170,
      trashTotal: 4,
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

  it('embeds the file preview across the Files page after resolving the physical path', async () => {
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_physical_paths') return Promise.resolve({ [entry.id]: '/tmp/report.md' })
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      return Promise.resolve(input)
    })
    renderFilesPage()

    fireEvent.click(screen.getByRole('button', { name: 'files.open' }))

    await waitFor(() => {
      expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_get_physical_paths', { ids: [entry.id] })
      expect(filePreviewMocks.render).toHaveBeenCalledWith({ filePath: '/tmp/report.md', refreshKey: 0 })
    })
    expect(screen.getByRole('region', { name: 'report.md' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.back' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.back' }))

    expect(screen.queryByRole('region', { name: 'report.md' })).not.toBeInTheDocument()
    expect(screen.getByText('report.md')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'files.open' })).toBeInTheDocument()
  })

  it('reports a file preview path resolution failure', async () => {
    const errorSpy = vi.spyOn(loggerService, 'error').mockImplementation(() => undefined)
    renderFilesPage()

    fireEvent.click(screen.getByRole('button', { name: 'files.open' }))

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('Failed to open file preview', expect.any(Error))
      expect(toast.error).toHaveBeenCalledWith('files.preview.error')
    })
    expect(filePreviewMocks.render).not.toHaveBeenCalled()
  })

  // Delays a settled value by several microtask hops so the earlier open request lands
  // AFTER the later one. Both requests still settle within a few ticks — no long-pending
  // promise (which would spin the mocked useDeferredValue render loop under act).
  const afterMicrotasks = <T,>(produce: () => T): Promise<T> =>
    Promise.resolve()
      .then()
      .then()
      .then()
      .then(() => produce())
  // Drains pending microtasks so the stale request provably finishes before we assert,
  // without waiting for React to go idle (the mock's unstable query refs never let it).
  const drainMicrotasks = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }

  it('keeps the most recently opened file when an older open request resolves last', async () => {
    const fileA = { ...entry, id: 'file-a', name: 'alpha', ext: 'md' } as unknown as FileEntry
    const fileB = { ...entry, id: 'file-b', name: 'bravo', ext: 'md' } as unknown as FileEntry
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_physical_paths') {
        const id = (input as { ids: string[] }).ids[0]
        // A (clicked first) settles several ticks later than B (clicked last).
        if (id === 'file-a') return afterMicrotasks(() => ({ 'file-a': '/tmp/alpha.md' }))
        return Promise.resolve({ [id]: '/tmp/bravo.md' })
      }
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      return Promise.resolve(input)
    })
    renderFilesPage([fileA, fileB])

    const openButtons = screen.getAllByRole('button', { name: 'files.open' })
    fireEvent.click(openButtons[0]) // A — the stale, slower request
    fireEvent.click(openButtons[1]) // B — the latest selection

    // B (latest) resolves first and is shown.
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'bravo.md' })).toBeInTheDocument()
    })

    // A (stale) resolves last and must NOT overwrite B.
    await drainMicrotasks()
    expect(filePreviewMocks.render).not.toHaveBeenCalledWith(expect.objectContaining({ filePath: '/tmp/alpha.md' }))
    expect(screen.getByRole('region', { name: 'bravo.md' })).toBeInTheDocument()
  })

  it('suppresses a stale open error after a newer open has already succeeded', async () => {
    const errorSpy = vi.spyOn(loggerService, 'error').mockImplementation(() => undefined)
    const fileA = { ...entry, id: 'file-a', name: 'alpha', ext: 'md' } as unknown as FileEntry
    const fileB = { ...entry, id: 'file-b', name: 'bravo', ext: 'md' } as unknown as FileEntry
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_physical_paths') {
        const id = (input as { ids: string[] }).ids[0]
        // A (clicked first) rejects several ticks later than B (clicked last) succeeds.
        if (id === 'file-a')
          return afterMicrotasks(() => {
            throw new Error('resolution failed')
          })
        return Promise.resolve({ [id]: '/tmp/bravo.md' })
      }
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      return Promise.resolve(input)
    })
    renderFilesPage([fileA, fileB])

    const openButtons = screen.getAllByRole('button', { name: 'files.open' })
    fireEvent.click(openButtons[0]) // A — the stale, slower request
    fireEvent.click(openButtons[1]) // B — the latest selection

    // B (latest) succeeds first.
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'bravo.md' })).toBeInTheDocument()
    })

    // A (stale) rejects last — its error must not surface over the new preview.
    await drainMicrotasks()
    expect(toast.error).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalledWith('Failed to open file preview', expect.any(Error))
    expect(screen.getByRole('region', { name: 'bravo.md' })).toBeInTheDocument()
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
        items: [{ source: 'path', path: '/tmp/import-from-button.md', cleanupPolicy: 'manual' }]
      })
      expect(refetchStats).toHaveBeenCalled()
    })
  })

  it('imports selected files from a type category view', async () => {
    const fileApi = window.api.file as typeof window.api.file & { select: ReturnType<typeof vi.fn> }
    fileApi.select = vi.fn().mockResolvedValue([{ path: '/tmp/import-from-text-category.md' }])
    mockFiles([entry])
    mockFileStats(statsForEntries([entry]), vi.fn().mockResolvedValue(undefined))
    render(<FilesPage />)

    fireEvent.click(screen.getByText('files.text'))
    fireEvent.click(screen.getByText('files.upload'))

    await waitFor(() => {
      expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_create_internal_entries', {
        items: [{ source: 'path', path: '/tmp/import-from-text-category.md', cleanupPolicy: 'manual' }]
      })
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

  it('selects the visible range when Shift-clicking a file checkbox', async () => {
    const secondEntry = { ...entry, id: 'file-2', name: 'notes' } as unknown as FileEntry
    const thirdEntry = { ...entry, id: 'file-3', name: 'summary' } as unknown as FileEntry
    renderFilesPage([entry, secondEntry, thirdEntry])
    const user = userEvent.setup()
    const checkboxes = screen.getAllByRole('checkbox', { name: 'files.select_file' })

    await user.click(checkboxes[0])
    await user.keyboard('{Shift>}')
    await user.click(checkboxes[2])
    await user.keyboard('{/Shift}')

    for (const checkbox of checkboxes) {
      expect(checkbox).toBeChecked()
    }
  })

  it('starts a new selection anchor after clearing the previous selection', async () => {
    const secondEntry = { ...entry, id: 'file-2', name: 'notes' } as unknown as FileEntry
    const thirdEntry = { ...entry, id: 'file-3', name: 'summary' } as unknown as FileEntry
    renderFilesPage([entry, secondEntry, thirdEntry])
    const user = userEvent.setup()
    const checkboxes = screen.getAllByRole('checkbox', { name: 'files.select_file' })

    await user.click(checkboxes[0])
    await user.click(checkboxes[0])
    await user.keyboard('{Shift>}')
    await user.click(checkboxes[2])
    await user.keyboard('{/Shift}')

    expect(checkboxes[0]).not.toBeChecked()
    expect(checkboxes[1]).not.toBeChecked()
    expect(checkboxes[2]).toBeChecked()
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

  it('shows contextual actions for a single selected file', () => {
    renderFilesPage()

    selectFileAt(0)

    const actionsButton = screen.getByRole('button', { name: 'files.actions' })

    expect(actionsButton).toBeInTheDocument()
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
      expect(toast.error).toHaveBeenCalledWith('files.error.delete_partial_failed')
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
      expect(toast.error).toHaveBeenCalledTimes(1)
      expect(toast.error).toHaveBeenCalledWith('files.error.delete_partial_failed')
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
      expect(toast.error).toHaveBeenCalledWith('files.error.delete_failed')
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
      expect(toast.error).toHaveBeenCalledWith('files.error.restore_partial_failed')
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
      expect(toast.error).toHaveBeenCalledWith('files.error.restore_failed')
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
      expect(toast.error).toHaveBeenCalledWith('files.error.rename_failed')
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
        items: [{ source: 'path', path: '/tmp/import.md', cleanupPolicy: 'manual' }]
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
      expect(toast.error).toHaveBeenCalledWith('files.error.import_partial_failed')
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
      expect(toast.error).toHaveBeenCalledWith('files.error.import_failed')
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
    expect(screen.queryByLabelText('files.open')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('files.rename')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('files.show_in_folder')).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByText('external.txt'))
    expect(screen.queryByText('files.rename')).not.toBeInTheDocument()
    expect(screen.queryByText('files.show_in_folder')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('files.remove_from_library'))

    await waitFor(() => {
      expect(ipcMocks.request).toHaveBeenCalledWith('file.batch_permanent_delete', { ids: [externalEntry.id] })
    })
  })

  it('keeps image files visible while preview path enrichment is pending', () => {
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_physical_paths') return new Promise(() => {})
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      return Promise.resolve(input)
    })
    renderFilesPage([imageEntry])

    fireEvent.click(screen.getByText('files.image'))

    expect(screen.getByText('photo.png')).toBeInTheDocument()
    expect(screen.queryByText('files.empty.title')).toBeNull()
    expect(screen.queryByText('files.empty.no_match_title')).toBeNull()
  })

  it('keeps image files visible when preview path enrichment fails', async () => {
    const errorSpy = vi.spyOn(loggerService, 'error').mockImplementation(() => undefined)
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_physical_paths') return Promise.reject(new Error('preview path failed'))
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      return Promise.resolve(input)
    })
    renderFilesPage([imageEntry])

    fireEvent.click(screen.getByText('files.image'))

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('Failed to load file IPC metadata', expect.any(Error))
    })
    expect(screen.getByText('photo.png')).toBeInTheDocument()
    expect(screen.queryByText('files.empty.title')).toBeNull()
    expect(screen.queryByText('files.empty.no_match_title')).toBeNull()
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
    expect(screen.queryByLabelText('files.actions')).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByAltText('photo.png'))
    fireEvent.click(screen.getByText('files.rename'))
    expect(screen.getByDisplayValue('photo.png')).toBeInTheDocument()
  })

  it('opens the shared image preview when clicking an image in the image grid', async () => {
    ipcMocks.request.mockImplementation((route: string, input?: unknown) => {
      if (route === 'file.batch_get_metadata') return Promise.resolve({})
      if (route === 'file.batch_get_physical_paths') return Promise.resolve({ [imageEntry.id]: '/tmp/photo.png' })
      if (route === 'file.batch_get_dangling_states') return Promise.resolve({})
      return Promise.resolve(input)
    })
    renderFilesPage([imageEntry])

    fireEvent.click(screen.getByText('files.image'))
    fireEvent.click(await screen.findByAltText('photo.png'))

    await waitFor(() => {
      expect(imagePreviewMocks.show).toHaveBeenCalledWith('file:///tmp/photo.png')
    })
    expect(filePreviewMocks.render).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'photo.png' })).not.toBeInTheDocument()
  })
})
