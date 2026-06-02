import { defaultLanguage } from '@shared/config/constant'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import EmojiPicker from '../index'

const loadEmojiDataMock = vi.hoisted(() => vi.fn())
const i18nLanguageMock = vi.hoisted(() => ({ value: 'en-US' }))

vi.mock('../data', () => ({
  loadEmojiData: loadEmojiDataMock
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

afterEach(async () => {
  const { MockUseCacheUtils } = await import('../../../../../tests/__mocks__/renderer/useCache')
  MockUseCacheUtils.resetMocks()
})

describe('EmojiPicker', () => {
  beforeEach(() => {
    i18nLanguageMock.value = defaultLanguage
    loadEmojiDataMock.mockReset()
    loadEmojiDataMock.mockResolvedValue([])
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
      'w-72',
      'max-h-[min(22rem,calc(100vh-6rem))]',
      'max-w-[calc(100vw-2rem)]'
    )
  })

  it('uses a contained internal scrollbar for the emoji grid', async () => {
    render(<EmojiPicker onEmojiClick={vi.fn()} />)
    await act(async () => {})

    expect(screen.getByTestId('emoji-scrollbar')).toHaveClass('min-h-0', 'flex-1', 'overscroll-contain')
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
    loadEmojiDataMock.mockRejectedValueOnce(error)
    loadEmojiDataMock.mockResolvedValueOnce([{ emoji: '🙂', annotation: 'smile', group: 0, order: 1 }])

    render(<EmojiPicker onEmojiClick={vi.fn()} />)
    await act(async () => {})

    expect(loggerSpy).toHaveBeenCalledWith('Failed to load emoji data', error)
    expect(loadEmojiDataMock).toHaveBeenNthCalledWith(1, 'zh-CN')
    expect(loadEmojiDataMock).toHaveBeenNthCalledWith(2, defaultLanguage)
    expect(screen.getByRole('button', { name: 'smile' })).toBeInTheDocument()
  })
})
