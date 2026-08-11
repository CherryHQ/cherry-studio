// @vitest-environment jsdom

import type { SpanEntity } from '@mcp-trace/trace-core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TRACE_ROW_HEIGHT } from '../traceNode'
import TraceTree from '../TraceTree'
import { TraceTreeModel } from '../TraceTreeModel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

function span(id: string, parentId: string | null = null, startTime = 0): SpanEntity {
  return {
    id,
    traceId: 'trace-1',
    parentId: parentId ?? '',
    name: id,
    status: 'OK',
    kind: 'INTERNAL',
    startTime,
    endTime: startTime + 1,
    attributes: {},
    isEnd: true,
    events: [],
    links: []
  }
}

describe('TraceTree with TanStack Virtual', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('moves the bounded render window when the real scroller moves', async () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    Object.defineProperties(HTMLElement.prototype, {
      offsetHeight: {
        configurable: true,
        get() {
          return (this as HTMLElement).dataset.testid === 'trace-list-scroll' ? TRACE_ROW_HEIGHT * 3 : TRACE_ROW_HEIGHT
        }
      },
      offsetWidth: { configurable: true, get: () => 600 }
    })

    let view: ReturnType<typeof render> | undefined

    try {
      const model = new TraceTreeModel()
      model.reset([
        span('root'),
        ...Array.from({ length: 100 }, (_, index) => span(`child-${index}`, 'root', index + 1))
      ])
      view = render(
        <TraceTree model={model} revision={model.lastMutation.revision} handleClick={vi.fn()} handleToggle={vi.fn()} />
      )

      await waitFor(() => expect(screen.getByRole('treeitem', { name: 'root' })).toBeInTheDocument())
      expect(screen.getAllByRole('treeitem').length).toBeLessThan(30)

      const scroller = screen.getByRole('tree', { name: 'trace.label' })
      scroller.scrollTop = 40 * TRACE_ROW_HEIGHT
      fireEvent.scroll(scroller)

      await waitFor(() => expect(screen.getByRole('treeitem', { name: 'child-39' })).toBeInTheDocument())
      expect(screen.queryByRole('treeitem', { name: 'child-20' })).not.toBeInTheDocument()
      expect(screen.getAllByRole('treeitem').length).toBeLessThan(30)
    } finally {
      view?.unmount()
      if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight)
      else Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight')
      if (originalOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth)
      else Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth')
    }
  })
})
