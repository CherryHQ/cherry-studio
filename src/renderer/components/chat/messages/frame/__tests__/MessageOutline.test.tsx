import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentPropsWithoutRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatBottomOverlayInsetProvider } from '../../../layout/ChatViewportInsetContext'
import type { MessageListItem } from '../../types'
import MessageOutline from '../MessageOutline'

vi.mock('@cherrystudio/ui', () => ({
  createSlugger: () => ({
    slug: (value: string) => value.toLowerCase().replace(/\s+/g, '-')
  }),
  extractTextFromNode: (node: { children?: Array<{ value?: string }> }) =>
    node.children?.map((child) => child.value ?? '').join('') ?? '',
  Scrollbar: ({ children, ...props }: ComponentPropsWithoutRef<'div'>) => <div {...props}>{children}</div>
}))

vi.mock('../../blocks/MessagePartsContext', () => ({
  useMessageParts: () => [{ type: 'text', text: '# Streaming heading' }]
}))

vi.mock('@renderer/utils/dom', () => ({
  scrollIntoView: vi.fn()
}))

const { scrollIntoView } = vi.mocked(await import('@renderer/utils/dom'))

function mountHeading(): { heading: HTMLElement; messageRoot: HTMLElement } {
  const messageRoot = document.createElement('div')
  messageRoot.id = 'message-assistant-1'
  messageRoot.dataset.messageOutlineFixture = 'true'
  const content = document.createElement('div')
  content.className = 'message-content-container'
  const heading = document.createElement('h1')
  heading.id = 'heading-assistant-1-part-0--streaming-heading'
  content.append(heading)
  messageRoot.append(content)
  document.body.append(messageRoot)
  return { heading, messageRoot }
}

describe('MessageOutline', () => {
  beforeEach(() => {
    scrollIntoView.mockClear()
  })

  afterEach(() => {
    document.querySelectorAll('[data-message-outline-fixture]').forEach((element) => element.remove())
  })

  it('routes heading navigation through the owning message list when another tab has the same message', () => {
    mountHeading()
    const { heading, messageRoot } = mountHeading()

    const onNavigateToElement = vi.fn()
    render(
      <MessageOutline
        getMessageElement={() => messageRoot}
        message={{ id: 'assistant-1' } as MessageListItem}
        multiModelMessageStyle="vertical"
        onNavigateToElement={onNavigateToElement}
      />
    )

    fireEvent.click(screen.getByText('Streaming heading'))

    expect(onNavigateToElement).toHaveBeenCalledWith(heading)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('scrolls the nearest container in horizontal layout, where the heading lives in a nested scroller', () => {
    const { heading, messageRoot } = mountHeading()

    const onNavigateToElement = vi.fn()
    render(
      <MessageOutline
        getMessageElement={() => messageRoot}
        message={{ id: 'assistant-1' } as MessageListItem}
        multiModelMessageStyle="horizontal"
        onNavigateToElement={onNavigateToElement}
      />
    )

    fireEvent.click(screen.getByText('Streaming heading'))

    expect(scrollIntoView).toHaveBeenCalledWith(heading, { behavior: 'smooth', block: 'nearest', container: 'nearest' })
    expect(onNavigateToElement).not.toHaveBeenCalled()
  })

  it('bounds the rail above the composer by the sum of the published bottom overlay insets', () => {
    const { container } = render(
      <ChatBottomOverlayInsetProvider value={{ contentBottomPadding: 128, scrollerBottomMargin: 12 }}>
        <MessageOutline
          getMessageElement={() => null}
          message={{ id: 'assistant-1' } as MessageListItem}
          multiModelMessageStyle="vertical"
          onNavigateToElement={() => {}}
        />
      </ChatBottomOverlayInsetProvider>
    )

    const scrollBox = container.querySelector('[data-ui="part:message-outline"]')
    expect(scrollBox).not.toBeNull()
    expect(scrollBox?.parentElement?.style.bottom).toBe('140px')
  })

  it('keeps the unbounded geometry when no overlay insets are published', () => {
    const { container } = render(
      <MessageOutline
        getMessageElement={() => null}
        message={{ id: 'assistant-1' } as MessageListItem}
        multiModelMessageStyle="vertical"
        onNavigateToElement={() => {}}
      />
    )

    const scrollBox = container.querySelector('[data-ui="part:message-outline"]')
    expect(scrollBox).not.toBeNull()
    expect(scrollBox?.parentElement?.style.bottom).toBe('0px')
  })

  it('still renders its heading rows inside the bounded rail', () => {
    render(
      <ChatBottomOverlayInsetProvider value={{ contentBottomPadding: 128, scrollerBottomMargin: 12 }}>
        <MessageOutline
          getMessageElement={() => null}
          message={{ id: 'assistant-1' } as MessageListItem}
          multiModelMessageStyle="vertical"
          onNavigateToElement={() => {}}
        />
      </ChatBottomOverlayInsetProvider>
    )

    expect(screen.getByText('Streaming heading')).toBeInTheDocument()
  })
})
