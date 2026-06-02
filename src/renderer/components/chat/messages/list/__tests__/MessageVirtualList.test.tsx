import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MessageVirtualList } from '../MessageVirtualList'

vi.mock('@cherrystudio/ui', () => {
  return {
    Scrollbar: ({ ref, children, ...props }: any) => (
      <div ref={ref} {...props}>
        {children}
      </div>
    )
  }
})

vi.mock('virtua', () => {
  return {
    Virtualizer: ({ ref, children, data, startMargin }: any) => (
      <div ref={ref} data-start-margin={startMargin} data-testid="virtualizer">
        {data.map((item: unknown, index: number) => (
          <div key={index}>{children(item, index)}</div>
        ))}
      </div>
    )
  }
})

vi.mock('../chatVirtualizerRuntime', async () => {
  const { createElement } = await import('react')
  return {
    useChatVirtualizerRuntime: vi.fn(({ items, renderItem }) => ({
      contentRef: { current: null },
      keepMounted: [],
      scrollerProps: {
        onScroll: vi.fn(),
        onScrollEnd: vi.fn(),
        onWheel: vi.fn()
      },
      scrollerRef: { current: null },
      vlistHandleRef: { current: null },
      wrappedItems: items,
      wrappedRenderItem: (item: unknown, index: number) =>
        createElement('div', { 'data-testid': `item-${index}` }, renderItem(item, index))
    }))
  }
})

describe('MessageVirtualList', () => {
  it('renders the top padding as real scroll content before the virtualizer', () => {
    render(
      <MessageVirtualList
        items={['message-1']}
        getItemKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
        topPadding={44}
      />
    )

    const spacer = document.querySelector('[data-message-virtual-list-top-spacer]')
    expect(spacer).toHaveStyle({ height: '44px' })
    expect(spacer?.nextElementSibling).toBe(screen.getByTestId('virtualizer'))
    expect(screen.getByTestId('virtualizer')).toHaveAttribute('data-start-margin', '44')
  })
})
