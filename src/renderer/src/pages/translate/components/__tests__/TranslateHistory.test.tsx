import { parsePersistedLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateHistory as TranslateHistoryItem, TranslateLanguage } from '@shared/data/types/translate'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TranslateHistory from '../TranslateHistory'

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

vi.mock('@renderer/utils', () => ({
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
    open
  }: {
    children: React.ReactNode
    header?: React.ReactNode
    open?: boolean
  }) =>
    open ? (
      <div>
        {header}
        {children}
      </div>
    ) : null
}))

const english: TranslateLanguage = {
  value: 'English',
  langCode: parsePersistedLangCode('en-us'),
  emoji: '🇬🇧',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const chinese: TranslateLanguage = {
  value: 'Chinese',
  langCode: parsePersistedLangCode('zh-cn'),
  emoji: '🇨🇳',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

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

    ;(window as any).toast = {
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      loading: vi.fn(),
      success: vi.fn()
    }

    translateHistoryMock.useTranslateHistory.mockReturnValue({
      clear: clearMock,
      update: updateMock,
      remove: removeMock
    })

    translateHistoryMock.useTranslateHistories.mockReturnValue({
      items: histories,
      total: histories.length,
      hasMore: false,
      isLoadingMore: false,
      loadMore: loadMoreMock,
      status: 'success'
    })
  })

  it('does not create one translate history mutation hook per visible row', () => {
    render(<TranslateHistory isOpen onHistoryItemClick={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('bye')).toBeInTheDocument()
    expect(translateHistoryMock.useTranslateHistory).toHaveBeenCalledTimes(1)
  })

  it('opens detail and supports reuse', () => {
    render(<TranslateHistory isOpen onHistoryItemClick={onHistoryItemClick} onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('hello'))
    expect(screen.getByText('translate.history.back')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'translate.history.reuse' }))
    expect(onHistoryItemClick).toHaveBeenCalledWith(expect.objectContaining({ id: '1', sourceText: 'hello' }))
  })

  it('invokes update mutation when clicking row star action', async () => {
    render(<TranslateHistory isOpen onHistoryItemClick={vi.fn()} onClose={vi.fn()} />)

    const row = screen.getByText('hello').closest('[role="button"]')
    expect(row).toBeTruthy()
    const rowStarButton = within(row as HTMLElement).getByRole('button', { name: 'translate.history.filter.starred' })
    fireEvent.click(rowStarButton)

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('1', { star: true }))
  })

  it('supports star toggle inside detail panel', async () => {
    render(<TranslateHistory isOpen onHistoryItemClick={vi.fn()} onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('hello'))
    const detailButtons = screen.getAllByRole('button', { name: 'translate.history.filter.starred' })
    fireEvent.click(detailButtons[detailButtons.length - 1])

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('1', { star: true }))
  })

  it('copies text from detail actions and shows success toast', async () => {
    render(<TranslateHistory isOpen onHistoryItemClick={vi.fn()} onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('hello'))
    const copyTargetButton = screen.getByRole('button', { name: 'translate.history.copy_target' })
    fireEvent.click(copyTargetButton)

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith('你好'))
    expect((window as any).toast.success).toHaveBeenCalledWith('translate.copied')
  })

  it('shows copy failure toast when clipboard write rejects', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('clipboard denied'))
    render(<TranslateHistory isOpen onHistoryItemClick={vi.fn()} onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('hello'))
    fireEvent.click(screen.getByRole('button', { name: 'translate.history.copy_target' }))

    await waitFor(() => expect((window as any).toast.error).toHaveBeenCalledWith('common.copy_failed'))
  })

  it('invokes delete mutation from detail confirm dialog flow', async () => {
    render(<TranslateHistory isOpen onHistoryItemClick={vi.fn()} onClose={vi.fn()} />)

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
    render(<TranslateHistory isOpen onHistoryItemClick={vi.fn()} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'translate.history.clear' }))

    const clearConfirm = [...translateHistoryMock.confirmDialogProps].reverse().find((dialog) => {
      return dialog.title === 'translate.history.clear'
    })

    await act(async () => {
      await clearConfirm?.onConfirm?.()
    })

    expect(clearMock).toHaveBeenCalledTimes(1)
  })

  it('loads more when scrolled near bottom in virtual list', async () => {
    translateHistoryMock.useTranslateHistories.mockReturnValueOnce({
      items: histories,
      total: histories.length,
      hasMore: true,
      isLoadingMore: false,
      loadMore: loadMoreMock,
      status: 'success'
    })

    render(<TranslateHistory isOpen onHistoryItemClick={vi.fn()} onClose={vi.fn()} />)

    const list = screen.getByTestId('virtual-list')
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 300 })
    Object.defineProperty(list, 'scrollTop', { configurable: true, value: 650 })

    fireEvent.scroll(list)

    await waitFor(() => expect(loadMoreMock).toHaveBeenCalledTimes(1))
  })
})
