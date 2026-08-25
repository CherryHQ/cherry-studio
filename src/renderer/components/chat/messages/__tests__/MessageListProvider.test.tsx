import { render, screen } from '@testing-library/react'
import { type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { MessageListProvider, useIsMessageEditing } from '../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListProviderValue } from '../types'

const baseValue: MessageListProviderValue = {
  state: {
    topic: { id: 'topic-1', name: 'Topic' } as MessageListProviderValue['state']['topic'],
    messages: [],
    partsByMessageId: {},
    messageNavigation: 'none',
    estimateSize: 400,
    overscan: 0,
    loadOlderDelayMs: 0,
    loadingResetDelayMs: 0,
    renderConfig: defaultMessageRenderConfig
  },
  actions: {},
  meta: { selectionLayer: false }
}

const createValue = (editingMessageId: string | null): MessageListProviderValue => ({
  ...baseValue,
  state: { ...baseValue.state, editingMessageId }
})

describe('MessageListProvider editing state', () => {
  it('updates only the previous and current editing message subscribers', () => {
    const renderCounts = new Map<string, number>()

    const EditingProbe = ({ messageId }: { messageId: string }) => {
      const isEditing = useIsMessageEditing(messageId)
      renderCounts.set(messageId, (renderCounts.get(messageId) ?? 0) + 1)
      return <span>{`${messageId}:${isEditing ? 'editing' : 'idle'}`}</span>
    }
    const probes: ReactNode = (
      <>
        <EditingProbe messageId="message-a" />
        <EditingProbe messageId="message-b" />
        <EditingProbe messageId="message-c" />
      </>
    )

    const { rerender } = render(<MessageListProvider value={createValue(null)}>{probes}</MessageListProvider>)

    rerender(<MessageListProvider value={createValue('message-a')}>{probes}</MessageListProvider>)
    expect(screen.getByText('message-a:editing')).toBeInTheDocument()
    expect(renderCounts).toEqual(
      new Map([
        ['message-a', 2],
        ['message-b', 1],
        ['message-c', 1]
      ])
    )

    rerender(<MessageListProvider value={createValue('message-b')}>{probes}</MessageListProvider>)
    expect(screen.getByText('message-a:idle')).toBeInTheDocument()
    expect(screen.getByText('message-b:editing')).toBeInTheDocument()
    expect(renderCounts).toEqual(
      new Map([
        ['message-a', 3],
        ['message-b', 2],
        ['message-c', 1]
      ])
    )

    rerender(<MessageListProvider value={createValue(null)}>{probes}</MessageListProvider>)
    expect(screen.getByText('message-b:idle')).toBeInTheDocument()
    expect(renderCounts.get('message-b')).toBe(3)
    expect(renderCounts.get('message-c')).toBe(1)
  })
})
