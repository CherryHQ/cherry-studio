import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type { TranslateHistory as TranslateHistoryItem, TranslateLanguage } from '@shared/data/types/translate'

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
    sourceText: 'bye',
    targetText: '再见',
    sourceLanguage: english.langCode,
    targetLanguage: chinese.langCode,
    star: true,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z'
  }
]

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

  const renderHistory = (onItemClick: (item: TranslateHistoryItem) => void = vi.fn()) =>
    render(<TranslateHistory isOpen onHistoryItemClick={onItemClick} onClose={vi.fn()} />)

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
