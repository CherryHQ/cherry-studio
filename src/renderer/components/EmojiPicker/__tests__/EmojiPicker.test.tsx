import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import EmojiPicker from '../index'

vi.mock('../data', () => ({
  loadEmojiData: vi.fn().mockResolvedValue([])
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en-US' }
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
})
