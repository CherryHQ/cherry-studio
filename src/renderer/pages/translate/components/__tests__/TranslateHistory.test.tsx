import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type { TranslateHistory as TranslateHistoryItem, TranslateLanguage } from '@shared/data/types/translate'

import type * as TranslationFilesModule from '../../translationFiles'
import TranslateHistory from '../TranslateHistory'
import { chinese, english } from './testUtils'

const translateHistoryMock = vi.hoisted(() => ({
  useTranslateHistory: vi.fn(),
  useTranslateHistories: vi.fn(),
  confirmDialogProps: [] as Array<{
    onConfirm?: () => void | Promise<void>
    onOpenChange?: (open: boolean) => void
    title?: string
  }>
}))

const writeTextMock = vi.hoisted(() => vi.fn())
const fileMocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  loadTranslationFiles: vi.fn(),
  saveTranslationFileAs: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: fileMocks.ipcRequest } }))
vi.mock('../../translationFiles', async (importOriginal) => ({
  // `isPdfTranslation` is a pure predicate on the row — keep the real one so the
  // preview button's gating is exercised, not mocked away.
  ...(await importOriginal<typeof TranslationFilesModule>()),
  loadTranslationFiles: fileMocks.loadTranslationFiles,
  saveTranslationFileAs: fileMocks.saveTranslationFileAs
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-us' } })
}))

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: ({
    list,
    children,
    onScroll
  }: {
    list: TranslateHistoryItem[]
    children: (item: TranslateHistoryItem) => React.ReactNode
    onScroll?: (event: React.UIEvent<HTMLDivElement>) => void
  }) => (
    <div data-testid="virtual-list" onScroll={onScroll}>
      {list.map((item) => (
        <div key={item.id}>{children(item)}</div>
      ))}
    </div>
  )
}))

vi.mock('@renderer/hooks/translate', () => ({
  useLanguages: () => ({
    getLanguage: (langCode: string) => languages.find((language) => language.langCode === langCode),
    getLabel: (language: TranslateLanguage | null) => language?.value
  }),
  useTranslateHistories: () => translateHistoryMock.useTranslateHistories(),
  useTranslateHistory: () => translateHistoryMock.useTranslateHistory()
}))

vi.mock('@renderer/utils/style', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@cherrystudio/ui', () => ({
  ConfirmDialog: (props: {
    onConfirm?: () => void | Promise<void>
    onOpenChange?: (open: boolean) => void
    title?: string
  }) => {
    translateHistoryMock.confirmDialogProps.push(props)
    return <div>{props.title}</div>
  },
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  NormalTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PageSidePanel: ({
    children,
    header,
    headerClassName,
    open
  }: {
    children: React.ReactNode
    header?: React.ReactNode
    headerClassName?: string
    open?: boolean
  }) =>
    open ? (
      <div>
        <div data-testid="page-side-panel-header" className={headerClassName}>
          {header}
        </div>
        {children}
      </div>
    ) : null
}))

const languages = [english, chinese]

const histories: TranslateHistoryItem[] = [
  {
    id: '1',
    kind: 'text',
    sourceText: 'hello',
    targetText: '你好',
    sourceLanguage: english.langCode,
    targetLanguage: chinese.langCode,
    star: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: '2',
    kind: 'text',
    sourceText: 'bye',
    targetText: '再见',
    sourceLanguage: english.langCode,
    targetLanguage: chinese.langCode,
    star: true,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z'
  }
]

const pdfHistory: TranslateHistoryItem = {
  id: '3',
  kind: 'file',
  sourceText: 'paper.pdf',
  targetText: 'paper.zh-CN.pdf',
  sourceLanguage: english.langCode,
  targetLanguage: chinese.langCode,
  star: false,
  createdAt: '2026-01-03T00:00:00.000Z',
  updatedAt: '2026-01-03T00:00:00.000Z'
}
const TRANSLATION_FILES = {
  source: { entryId: 'entry-source', path: '/tmp/paper.pdf' },
  target: { entryId: 'entry-target', path: '/tmp/files/entry-target.pdf' }
}

describe('TranslateHistory', () => {
  const clearMock = vi.fn()
  const updateMock = vi.fn()
  const removeMock = vi.fn()
  const loadMoreMock = vi.fn()
  const onHistoryItemClick = vi.fn()

  const historyState = (overrides: Record<string, unknown> = {}) => ({
    items: histories,
    total: histories.length,
    hasMore: false,
    isLoadingMore: false,
    loadMore: loadMoreMock,
    status: 'success',
    ...overrides
  })

  const renderHistory = (
    onItemClick: (item: TranslateHistoryItem, files?: TranslationFilesModule.TranslationFiles) => void = vi.fn()
  ) => render(<TranslateHistory isOpen onHistoryItemClick={onItemClick} onClose={vi.fn()} />)

  beforeEach(() => {
    translateHistoryMock.useTranslateHistory.mockReset()
    translateHistoryMock.useTranslateHistories.mockReset()
    translateHistoryMock.confirmDialogProps = []
    clearMock.mockReset()
    updateMock.mockReset()
    removeMock.mockReset()
    loadMoreMock.mockReset()
    onHistoryItemClick.mockReset()
    writeTextMock.mockReset()
    writeTextMock.mockResolvedValue(undefined)
    fileMocks.ipcRequest.mockReset()
    fileMocks.ipcRequest.mockResolvedValue(undefined)
    fileMocks.saveTranslationFileAs.mockReset()
    fileMocks.saveTranslationFileAs.mockResolvedValue(undefined)
    fileMocks.loadTranslationFiles.mockReset()
    fileMocks.loadTranslationFiles.mockResolvedValue(TRANSLATION_FILES)

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: writeTextMock
      }
    })

    translateHistoryMock.useTranslateHistory.mockReturnValue({
      clear: clearMock,
      update: updateMock,
      remove: removeMock
    })

    translateHistoryMock.useTranslateHistories.mockReturnValue(historyState())
  })

  it('does not create one translate history mutation hook per visible row', () => {
    renderHistory()

    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('bye')).toBeInTheDocument()
    expect(translateHistoryMock.useTranslateHistory).toHaveBeenCalledTimes(1)
  })

  it('localizes compact header spacing to the translate history drawer', () => {
    renderHistory()

    expect(screen.getByTestId('page-side-panel-header')).toHaveClass('pb-0')
  })

  it('opens detail and supports reuse', () => {
    renderHistory(onHistoryItemClick)

    fireEvent.click(screen.getByText('hello'))
    expect(screen.getByText('translate.history.back')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'translate.history.reuse' }))
    expect(onHistoryItemClick).toHaveBeenCalledWith(expect.objectContaining({ id: '1', sourceText: 'hello' }))
  })

  describe('PDF entries', () => {
    const openPdfDetail = async (item: TranslateHistoryItem = pdfHistory) => {
      translateHistoryMock.useTranslateHistories.mockReturnValue(historyState({ items: [item], total: 1 }))
      renderHistory(onHistoryItemClick)
      fireEvent.click(screen.getByText(item.sourceText))
      await waitFor(() => expect(fileMocks.loadTranslationFiles).toHaveBeenCalledWith('3'))
      // Assertions below describe the loaded panel — settle the load the click started,
      // otherwise "no preview button" passes for the trivial reason that nothing rendered yet.
      await act(async () => {
        await fileMocks.loadTranslationFiles.mock.results[0]?.value
      })
    }

    it('marks a PDF row in the list', () => {
      translateHistoryMock.useTranslateHistories.mockReturnValue(historyState({ items: [pdfHistory], total: 1 }))
      renderHistory()

      expect(screen.getByLabelText('translate.history.file.badge')).toBeInTheDocument()
      expect(screen.getByText('paper.zh-CN.pdf')).toBeInTheDocument()
    })

    it('shows both file names instead of the text panes', async () => {
      await openPdfDetail()

      expect(screen.getByText('translate.history.file.source')).toBeInTheDocument()
      expect(screen.getByText('translate.history.file.target')).toBeInTheDocument()
      // The text-row affordances make no sense for a pair of PDFs.
      expect(screen.queryByRole('button', { name: 'translate.history.copy_target' })).not.toBeInTheDocument()
    })

    it('opens, reveals and exports the translated PDF', async () => {
      await openPdfDetail()

      fireEvent.click(screen.getByRole('button', { name: 'translate.history.file.open' }))
      await waitFor(() =>
        expect(fileMocks.ipcRequest).toHaveBeenCalledWith('file.open', { kind: 'entry', entryId: 'entry-target' })
      )

      fireEvent.click(screen.getAllByRole('button', { name: 'translate.history.file.reveal' })[0])
      await waitFor(() =>
        expect(fileMocks.ipcRequest).toHaveBeenCalledWith('file.show_in_folder', {
          kind: 'entry',
          entryId: 'entry-source'
        })
      )

      fireEvent.click(screen.getByRole('button', { name: 'translate.history.file.export' }))
      await waitFor(() =>
        expect(fileMocks.saveTranslationFileAs).toHaveBeenCalledWith('/tmp/files/entry-target.pdf', 'paper.zh-CN.pdf')
      )
    })

    it('hands the row back to the page so it can restore the side-by-side preview', async () => {
      await openPdfDetail()

      fireEvent.click(screen.getByRole('button', { name: 'translate.history.file.preview' }))

      expect(onHistoryItemClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: '3', kind: 'file' }),
        TRANSLATION_FILES
      )
    })

    it('reports a missing translated file in the detail panel', async () => {
      fileMocks.loadTranslationFiles.mockResolvedValue({
        source: TRANSLATION_FILES.source,
        target: null
      })

      await openPdfDetail()

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('translate.history.file.unavailable'))
      expect(screen.getByRole('button', { name: 'translate.history.file.open' })).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'translate.history.file.preview' })).not.toBeInTheDocument()
    })

    it('does not offer preview when the source ref is missing', async () => {
      fileMocks.loadTranslationFiles.mockResolvedValue({
        source: null,
        target: TRANSLATION_FILES.target
      })

      await openPdfDetail()

      await waitFor(() => expect(screen.getByRole('button', { name: 'translate.history.file.open' })).toBeEnabled())
      expect(screen.queryByRole('button', { name: 'translate.history.file.preview' })).not.toBeInTheDocument()
    })

    it('logs a late load failure without notifying after the detail panel unmounts', async () => {
      const loggerError = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
      const lateError = new Error('late failure')
      let rejectLoad!: (error: Error) => void
      fileMocks.loadTranslationFiles.mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectLoad = reject
        })
      )
      translateHistoryMock.useTranslateHistories.mockReturnValue(historyState({ items: [pdfHistory], total: 1 }))
      const { unmount } = renderHistory(onHistoryItemClick)
      fireEvent.click(screen.getByText('paper.pdf'))
      await waitFor(() => expect(fileMocks.loadTranslationFiles).toHaveBeenCalledWith('3'))

      unmount()
      await act(async () => {
        rejectLoad(lateError)
      })

      expect(loggerError).toHaveBeenCalledWith('Failed to load the files of a translate history entry', lateError)
      expect(toast.error).not.toHaveBeenCalled()
    })

    // `kind` says "this row is a pair of files", not "this row is a pair of PDFs".
    // Everything but the side-by-side preview must keep working for other formats.
    it('keeps the file actions but drops the preview for a non-PDF pair', async () => {
      await openPdfDetail({ ...pdfHistory, sourceText: 'report.docx', targetText: 'report.zh-CN.docx' })

      expect(screen.getByRole('button', { name: 'translate.history.file.open' })).toBeEnabled()
      expect(screen.getAllByRole('button', { name: 'translate.history.file.reveal' })).toHaveLength(2)
      expect(screen.queryByRole('button', { name: 'translate.history.file.preview' })).not.toBeInTheDocument()
    })
  })

  it('invokes update mutation when clicking row star action', async () => {
    renderHistory()

    const row = screen.getByText('hello').closest('[role="button"]')
    expect(row).toBeTruthy()
    const rowStarButton = within(row as HTMLElement).getByRole('button', { name: 'translate.history.star' })
    fireEvent.click(rowStarButton)

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('1', { star: true }))
  })

  // The row star toggles that row's favourite state, so its name must stay the action's name
  // (not the list filter's) and stay stable across states — the state itself is `aria-pressed`.
  it('names the row star action after the favourite action and exposes its state via aria-pressed', () => {
    renderHistory()

    const unstarredRow = screen.getByText('hello').closest('[role="button"]') as HTMLElement
    expect(within(unstarredRow).getByRole('button', { name: 'translate.history.star' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )

    const starredRow = screen.getByText('bye').closest('[role="button"]') as HTMLElement
    expect(within(starredRow).getByRole('button', { name: 'translate.history.star' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('names the detail star action after the favourite action and exposes its state via aria-pressed', () => {
    renderHistory()

    fireEvent.click(screen.getByText('hello'))
    expect(screen.getByRole('button', { name: 'translate.history.star' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByText('translate.history.back'))
    fireEvent.click(screen.getByText('bye'))
    expect(screen.getByRole('button', { name: 'translate.history.star' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('supports star toggle inside detail panel', async () => {
    renderHistory()

    fireEvent.click(screen.getByText('hello'))
    fireEvent.click(screen.getByRole('button', { name: 'translate.history.star' }))

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('1', { star: true }))
  })

  it('copies text from detail actions and shows success toast', async () => {
    renderHistory()

    fireEvent.click(screen.getByText('hello'))
    const actionLabels = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent)
    const detailStarIndex = actionLabels.indexOf('translate.history.star')
    expect(actionLabels.indexOf('translate.history.delete')).toBeLessThan(detailStarIndex)
    const copyTargetButton = screen.getByRole('button', { name: 'translate.history.copy_target' })
    expect(copyTargetButton).toHaveClass('text-primary-foreground')
    fireEvent.click(copyTargetButton)

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith('你好'))
    expect(toast.success).toHaveBeenCalledWith('translate.copied')
  })

  it('shows copy failure toast when clipboard write rejects', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('clipboard denied'))
    renderHistory()

    fireEvent.click(screen.getByText('hello'))
    fireEvent.click(screen.getByRole('button', { name: 'translate.history.copy_target' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('common.copy_failed'))
  })

  it('invokes delete mutation from detail confirm dialog flow', async () => {
    renderHistory()

    fireEvent.click(screen.getByText('hello'))
    fireEvent.click(screen.getByRole('button', { name: 'translate.history.delete' }))

    const deleteConfirm = [...translateHistoryMock.confirmDialogProps].reverse().find((dialog) => {
      return dialog.title === 'translate.history.delete'
    })

    await act(async () => {
      await deleteConfirm?.onConfirm?.()
    })

    expect(removeMock).toHaveBeenCalledWith('1')
  })

  it('invokes clear mutation from confirm dialog flow', async () => {
    renderHistory()

    fireEvent.click(screen.getByRole('button', { name: 'translate.history.clear' }))

    const clearConfirm = [...translateHistoryMock.confirmDialogProps].reverse().find((dialog) => {
      return dialog.title === 'translate.history.clear'
    })

    await act(async () => {
      await clearConfirm?.onConfirm?.()
    })

    expect(clearMock).toHaveBeenCalledTimes(1)
  })

  it('centers the empty state and hides history actions', () => {
    translateHistoryMock.useTranslateHistories.mockReturnValueOnce(
      historyState({
        items: [],
        total: 0,
        status: 'ready'
      })
    )

    renderHistory()

    expect(screen.getByText('translate.history.empty')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'translate.history.filter.starred' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'translate.history.clear' })).not.toBeInTheDocument()
    expect(screen.getByText('translate.history.empty').parentElement).toHaveClass(
      'flex',
      'min-h-0',
      'flex-1',
      'items-center',
      'justify-center'
    )
  })

  it('keeps the action bar visible when star-filter is active but its results are empty', () => {
    // Initial mount: histories present so the filter button is exposed for the user to click.
    // Every subsequent call (after toggling showStared=true) returns the empty filter result.
    translateHistoryMock.useTranslateHistories.mockReturnValue(
      historyState({
        items: [],
        total: 0,
        status: 'ready'
      })
    )
    translateHistoryMock.useTranslateHistories.mockReturnValueOnce(historyState({ status: 'ready' }))

    renderHistory()

    const filterButton = screen.getByRole('button', { name: 'translate.history.filter.starred' })
    fireEvent.click(filterButton)

    // Filter button must stay so the user can cancel the empty starred view; otherwise they are trapped.
    expect(screen.getByRole('button', { name: 'translate.history.filter.starred' })).toBeInTheDocument()
    // Clear button is correctly hidden when there's nothing to clear; only the filter toggle persists.
    expect(screen.queryByRole('button', { name: 'translate.history.clear' })).not.toBeInTheDocument()
  })

  it('loads more when scrolled near bottom in virtual list', async () => {
    translateHistoryMock.useTranslateHistories.mockReturnValueOnce(
      historyState({
        hasMore: true,
        status: 'success'
      })
    )

    renderHistory()

    const list = screen.getByTestId('virtual-list')
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 300 })
    Object.defineProperty(list, 'scrollTop', { configurable: true, value: 650 })

    fireEvent.scroll(list)

    await waitFor(() => expect(loadMoreMock).toHaveBeenCalledTimes(1))
  })

  it('coalesces repeated near-bottom scroll events into one load request', async () => {
    translateHistoryMock.useTranslateHistories.mockReturnValueOnce(
      historyState({
        hasMore: true,
        status: 'success'
      })
    )

    renderHistory()

    const list = screen.getByTestId('virtual-list')
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 300 })
    Object.defineProperty(list, 'scrollTop', { configurable: true, value: 650 })

    fireEvent.scroll(list)
    fireEvent.scroll(list)

    await waitFor(() => expect(loadMoreMock).toHaveBeenCalledTimes(1))
  })
})
