import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageListItem } from '../../types'
import MessageOutline from '../MessageOutline'

vi.mock('@cherrystudio/ui', () => ({
  createSlugger: () => ({
    slug: (value: string) => value.toLowerCase().replace(/\s+/g, '-')
  }),
  extractTextFromNode: (node: { children?: Array<{ value?: string }> }) =>
    node.children?.map((child) => child.value ?? '').join('') ?? '',
  Scrollbar: ({ children }: { children: ReactNode }) => <div>{children}</div>
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
})
