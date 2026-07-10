import { defaultLanguage } from '@shared/utils/languages'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EmojiPicker } from '..'

const loadStableEmojiOptionsMock = vi.hoisted(() => vi.fn())
const i18nLanguageMock = vi.hoisted(() => ({ value: 'en-US' }))

type VirtualizerOptionsMock = {
  count: number
  estimateSize: (index: number) => number
}

const virtualizerMocks = vi.hoisted(() => ({
  visibleIndexes: undefined as number[] | undefined,
  useVirtualizer: vi.fn((options: VirtualizerOptionsMock) => {
    const indexes = virtualizerMocks.visibleIndexes ?? Array.from({ length: options.count }, (_, index) => index)
    return {
      getTotalSize: () => options.count * 44,
      getVirtualItems: () => indexes.map((index) => ({ index, key: index, size: 44, start: index * 44 })),
      measureElement: vi.fn()
    }
  })
}))

vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: vi.fn((range: { startIndex: number; endIndex: number }) =>
    Array.from({ length: range.endIndex - range.startIndex + 1 }, (_, index) => range.startIndex + index)
  ),
  useVirtualizer: virtualizerMocks.useVirtualizer
}))

vi.mock('../data', () => ({
  loadStableEmojiOptions: loadStableEmojiOptionsMock
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: i18nLanguageMock.value }
  })
}))

vi.mock('@cherrystudio/ui', () => {
  const React = require('react')
  const Scrollbar = ({ children, className, ref }: any) =>
    React.createElement('div', { ref, className, 'data-testid': 'emoji-scrollbar' }, children)
  return { Scrollbar }
})

vi.mock('@cherrystudio/ui/fluent-emoji', () => {
  const React = require('react')
  const EmojiGlyph = ({ emoji }: { emoji: string }) => React.createElement('span', null, emoji)
  return { EmojiGlyph, hasFluentEmojiIcon: () => true }
})

afterEach(async () => {
  const { MockUseCacheUtils } = await import('../../../../../tests/__mocks__/renderer/useCache')
  MockUseCacheUtils.resetMocks()
})

describe('EmojiPicker', () => {
  beforeEach(() => {
    i18nLanguageMock.value = defaultLanguage
    virtualizerMocks.visibleIndexes = undefined
    virtualizerMocks.useVirtualizer.mockClear()
    loadStableEmojiOptionsMock.mockReset()
    loadStableEmojiOptionsMock.mockResolvedValue([])
  })

  it('renders without the search controls or bottom category tabs', async () => {
    render(<EmojiPicker onEmojiClick={vi.fn()} />)
    await act(async () => {})

    expect(screen.queryByPlaceholderText('emoji_picker.search')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('uses the compact floating picker dimensions', async () => {
    const { container } = render(<EmojiPicker onEmojiClick={vi.fn()} />)
    await act(async () => {})

    expect(container.firstElementChild).toHaveClass(
      'h-88',
      'w-80',
      'max-h-[min(22rem,calc(100vh-6rem))]',
      'max-w-[calc(100vw-2rem)]'
    )
  })

  it('uses a contained internal scrollbar for the emoji grid', async () => {
    render(<EmojiPicker onEmojiClick={vi.fn()} />)
    await act(async () => {})

    expect(screen.getByTestId('emoji-scrollbar')).toHaveClass('min-h-0', 'flex-1', 'overscroll-contain')
  })

  it('uses the previous compact emoji glyph size in the grid', async () => {
    const { MockUseCacheUtils } = await import('../../../../../tests/__mocks__/renderer/useCache')
    MockUseCacheUtils.setPersistCacheValue('ui.emoji.recently_used', ['🧠'])

    render(<EmojiPicker onEmojiClick={vi.fn()} />)
    await act(async () => {})

    expect(screen.getByRole('button', { name: '🧠' })).toHaveClass('text-2xl')
  })

  it('calls onEmojiClick when a recent emoji is picked', async () => {
    const { MockUseCacheUtils } = await import('../../../../../tests/__mocks__/renderer/useCache')
    MockUseCacheUtils.setPersistCacheValue('ui.emoji.recently_used', ['🧠', '📁'])

    const handleClick = vi.fn()
    render(<EmojiPicker onEmojiClick={handleClick} />)
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: '🧠' }))
    expect(handleClick).toHaveBeenCalledWith('🧠')
  })

  it('promotes a picked recent emoji to the front', async () => {
    const { MockUseCacheUtils } = await import('../../../../../tests/__mocks__/renderer/useCache')
    MockUseCacheUtils.setPersistCacheValue('ui.emoji.recently_used', ['🧠', '📁'])

    render(<EmojiPicker onEmojiClick={vi.fn()} />)
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: '📁' }))
    expect(MockUseCacheUtils.getPersistCacheValue('ui.emoji.recently_used')).toEqual(['📁', '🧠'])
  })

  it('logs failed locale data loads and falls back to English emoji data', async () => {
    const error = new Error('locale load failed')
    const loggerSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    i18nLanguageMock.value = 'zh-CN'
    loadStableEmojiOptionsMock.mockRejectedValueOnce(error)
    loadStableEmojiOptionsMock.mockResolvedValueOnce([{ emoji: '🙂', annotation: 'smile', group: 0, order: 1 }])

    render(<EmojiPicker onEmojiClick={vi.fn()} />)
    await act(async () => {})

    expect(loggerSpy).toHaveBeenCalledWith('Failed to load emoji data', error)
    expect(loadStableEmojiOptionsMock).toHaveBeenNthCalledWith(1, 'zh-CN')
    expect(loadStableEmojiOptionsMock).toHaveBeenNthCalledWith(2, defaultLanguage)
    expect(screen.getByRole('button', { name: 'smile' })).toBeInTheDocument()
  })

  it('windows category headers and seven-column emoji rows', async () => {
    const records = Array.from({ length: 20 }, (_, index) => ({
      emoji: String.fromCodePoint(0x1f600 + index),
      annotation: `emoji ${index + 1}`,
      group: 0,
      order: index
    }))
    loadStableEmojiOptionsMock.mockResolvedValueOnce(records)
    virtualizerMocks.visibleIndexes = [0, 1]

    render(<EmojiPicker onEmojiClick={vi.fn()} />)
    await act(async () => {})

    expect(virtualizerMocks.useVirtualizer).toHaveBeenLastCalledWith(expect.objectContaining({ count: 4, overscan: 3 }))
    expect(screen.getByRole('button', { name: 'emoji 1' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'emoji 8' })).not.toBeInTheDocument()
  })
})
