import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as CherryUI from '@cherrystudio/ui'
import type { CherryMessagePart } from '@shared/data/types/message'

import { KeyedMessageActivityStore } from '../../hooks/useMessageActivityState'
import { MessageListProvider } from '../../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem, type MessageListProviderValue } from '../../types'
import { PartsProvider } from '../MessagePartsContext'
import MessagePartsRenderer from '../MessagePartsRenderer'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryUI>())

const banner = 'hook blocked\n![audit](https://example.com/pixel)\n<!-- policy hidden -->'

function renderBanner(plainText: boolean, renderInputMessageAsMarkdown: boolean) {
  const message: MessageListItem = {
    id: 'hook-blocked',
    role: 'assistant',
    assistantId: 'assistant',
    topicId: 'topic',
    createdAt: '2026-01-01T00:00:00Z',
    status: 'success'
  }
  const parts: CherryMessagePart[] = [
    {
      type: 'text',
      text: banner,
      state: 'done',
      ...(plainText ? { providerMetadata: { cherry: { plainText: true } } } : {})
    }
  ]
  const activityStore = new KeyedMessageActivityStore()
  const value: MessageListProviderValue = {
    state: {
      topic: { id: message.topicId, name: 'Topic' } as MessageListProviderValue['state']['topic'],
      messages: [message],
      partsByMessageId: { [message.id]: parts },
      messageNavigation: 'none',
      estimateSize: 400,
      overscan: 0,
      loadOlderDelayMs: 0,
      loadingResetDelayMs: 0,
      renderConfig: { ...defaultMessageRenderConfig, renderInputMessageAsMarkdown },
      messageActivityStore: activityStore,
      getMessageActivityState: activityStore.getSnapshot
    },
    actions: {},
    meta: { selectionLayer: false }
  }
  return render(
    <MessageListProvider value={value}>
      <PartsProvider value={{ [message.id]: parts }}>
        <MessagePartsRenderer message={message} />
      </PartsProvider>
    </MessageListProvider>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('terminating informational banner rendering', () => {
  it.each([false, true])('shows literal banner text without image requests (input Markdown: %s)', (markdown) => {
    const fetch = vi.fn().mockRejectedValue(new Error('Unexpected network request'))
    vi.stubGlobal('fetch', fetch)
    const { container } = renderBanner(true, markdown)

    expect.soft(screen.queryByText(/!\[audit\]\(https:\/\/example.com\/pixel\)/)).toBeVisible()
    expect.soft(screen.queryByText(/<!-- policy hidden -->/)).toBeVisible()
    expect.soft(container.textContent).toBe(banner)
    expect.soft(container.querySelector('img')).toBeNull()
    expect.soft(container.querySelector('img[src="https://example.com/pixel"]')).toBeNull()
    expect.soft(container.querySelector('a[href="https://example.com/pixel"]')).toBeNull()
    expect(
      fetch.mock.calls.filter(([input]) => String(input instanceof Request ? input.url : input).includes('example.com'))
    ).toEqual([])
  })

  it('still renders the same unmarked assistant text as Markdown', () => {
    renderBanner(false, false)

    expect(screen.getByRole('img', { name: 'audit' })).toHaveAttribute('src', 'https://example.com/pixel')
    expect(screen.queryByText(/<!-- policy hidden -->/)).not.toBeInTheDocument()
  })
})
