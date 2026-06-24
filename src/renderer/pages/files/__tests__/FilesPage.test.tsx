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
})

describe('FilesPage image rename dialog', () => {
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
