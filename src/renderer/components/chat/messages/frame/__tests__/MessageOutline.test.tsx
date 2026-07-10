import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

describe('MessageOutline', () => {
  afterEach(() => {
    document.getElementById('message-assistant-1')?.remove()
  })

  it('routes heading navigation through the message-list runtime', () => {
    const messageRoot = document.createElement('div')
    messageRoot.id = 'message-assistant-1'
    const content = document.createElement('div')
    content.className = 'message-content-container'
    const heading = document.createElement('h1')
    heading.id = 'heading-assistant-1-part-0--streaming-heading'
    content.append(heading)
    messageRoot.append(content)
    document.body.append(messageRoot)

    const onNavigateToElement = vi.fn()
    render(
      <MessageOutline
        message={{ id: 'assistant-1' } as MessageListItem}
        multiModelMessageStyle="vertical"
        onNavigateToElement={onNavigateToElement}
      />
    )

    fireEvent.click(screen.getByText('Streaming heading'))

    expect(onNavigateToElement).toHaveBeenCalledWith(heading, 'start')
  })
})
