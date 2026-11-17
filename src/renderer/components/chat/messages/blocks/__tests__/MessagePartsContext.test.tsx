import { render, screen } from '@testing-library/react'
import { memo } from 'react'
import { describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import {
  MessagePartsScopeProvider,
  PartsProvider,
  useMessagePartsScopeId,
  useScopedPartsMap
} from '../MessagePartsContext'

function MessageIdProbe() {
  return <span>{useMessagePartsScopeId() ?? 'no-message'}</span>
}

const text = (value: string): CherryMessagePart => ({ type: 'text', text: value })

let scopedRenders = 0
const ScopedMapProbe = memo(function ScopedMapProbe() {
  const partsMap = useScopedPartsMap()
  scopedRenders++
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
      scopedRenders = 0

      const { rerender } = render(tree({ history: historyParts, streaming: [text('a')] }))
      rerender(tree({ history: historyParts, streaming: [text('ab')] }))
      rerender(tree({ history: historyParts, streaming: [text('abc')] }))

      expect(scopedRenders).toBe(1)
      expect(JSON.parse(screen.getByTestId('scoped-map').textContent)).toEqual({ history: historyParts })

      const updatedHistoryParts = [text('history'), text('approval')]
      rerender(tree({ history: updatedHistoryParts, streaming: [text('abc')] }))

      expect(scopedRenders).toBe(2)
      expect(JSON.parse(screen.getByTestId('scoped-map').textContent)).toEqual({ history: updatedHistoryParts })
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
