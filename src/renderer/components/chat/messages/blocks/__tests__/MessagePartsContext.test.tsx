import { render, screen } from '@testing-library/react'
import { memo } from 'react'
import { describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import {
  MessagePartsScopeProvider,
  PartsProvider,
  ToolPartScopeProvider,
  useMessagePartsScopeId,
  useScopedPartsMap
} from '../MessagePartsContext'

function MessageIdProbe() {
  return <span>{useMessagePartsScopeId() ?? 'no-message'}</span>
}

const text = (value: string): CherryMessagePart => ({ type: 'text', text: value })

const ScopedMapProbe = memo(function ScopedMapProbe() {
  const partsMap = useScopedPartsMap()
  return <span data-testid="scoped-map">{JSON.stringify(partsMap)}</span>
})

describe('MessagePartsContext', () => {
  it('keeps the message ID available through a nested parts provider', () => {
    render(
      <MessagePartsScopeProvider messageId="message-1" parts={[]}>
        <PartsProvider value={{}}>
          <MessageIdProbe />
        </PartsProvider>
      </MessagePartsScopeProvider>
    )

    expect(screen.getByText('message-1')).toBeInTheDocument()
  })

  describe('useScopedPartsMap', () => {
    it('skips chunks of other messages and follows its own message parts', () => {
      const historyParts = [text('history')]
      const tree = (map: Record<string, CherryMessagePart[]>) => (
        <PartsProvider value={map}>
          <MessagePartsScopeProvider messageId="history" parts={map.history}>
            <ScopedMapProbe />
          </MessagePartsScopeProvider>
        </PartsProvider>
      )

      const { rerender } = render(tree({ history: historyParts, streaming: [text('a')] }))
      rerender(tree({ history: historyParts, streaming: [text('ab')] }))
      rerender(tree({ history: historyParts, streaming: [text('abc')] }))

      expect(JSON.parse(screen.getByTestId('scoped-map').textContent)).toEqual({ history: historyParts })

      const updatedHistoryParts = [text('history'), text('approval')]
      rerender(tree({ history: updatedHistoryParts, streaming: [text('abc')] }))

      expect(JSON.parse(screen.getByTestId('scoped-map').textContent)).toEqual({ history: updatedHistoryParts })
    })

    it('exposes its own live approval part while sibling text and other tools change', () => {
      const pending: CherryMessagePart = {
        type: 'dynamic-tool',
        toolName: 'read',
        toolCallId: 'call-1',
        state: 'approval-requested',
        input: { file_path: '/tmp/report.txt' },
        approval: { id: 'approval-1' }
      }
      const tree = (part: CherryMessagePart, sibling: string) => (
        <PartsProvider value={{ other: [text('unrelated')] }}>
          <MessagePartsScopeProvider messageId="current" parts={[text(sibling), part]}>
            <ToolPartScopeProvider messageId="current" part={part}>
              <ScopedMapProbe />
            </ToolPartScopeProvider>
          </MessagePartsScopeProvider>
        </PartsProvider>
      )
      const { rerender } = render(tree(pending, 'first text'))
      rerender(tree(pending, 'streamed text'))
      expect(JSON.parse(screen.getByTestId('scoped-map').textContent)).toEqual({ current: [pending] })
      const approved: CherryMessagePart = {
        ...pending,
        state: 'approval-responded',
        approval: { id: 'approval-1', approved: true }
      }
      rerender(tree(approved, 'more text'))
      expect(JSON.parse(screen.getByTestId('scoped-map').textContent)).toEqual({ current: [approved] })
    })

    it('resets an outer tool scope when entering a different message scope', () => {
      const nested = [text('nested message')]
      render(
        <ToolPartScopeProvider messageId="outer" part={text('outer tool')}>
          <MessagePartsScopeProvider messageId="nested" parts={nested}>
            <ScopedMapProbe />
          </MessagePartsScopeProvider>
        </ToolPartScopeProvider>
      )
      expect(JSON.parse(screen.getByTestId('scoped-map').textContent)).toEqual({ nested })
    })

    it('resets an outer tool scope inside an isolated parts provider', () => {
      const isolated = { nested: [text('isolated nested parts')] }
      render(
        <ToolPartScopeProvider messageId="outer" part={text('outer tool')}>
          <PartsProvider value={isolated}>
            <ScopedMapProbe />
          </PartsProvider>
        </ToolPartScopeProvider>
      )
      expect(JSON.parse(screen.getByTestId('scoped-map').textContent)).toEqual(isolated)
    })

    it('falls back to the complete map outside a message scope', () => {
      const map = { first: [text('one')], second: [text('two')] }

      render(
        <PartsProvider value={map}>
          <ScopedMapProbe />
        </PartsProvider>
      )

      expect(JSON.parse(screen.getByTestId('scoped-map').textContent)).toEqual(map)
    })
  })
})
