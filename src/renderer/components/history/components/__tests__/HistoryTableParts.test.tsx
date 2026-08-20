import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode, Ref } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { HistoryVirtualTable } from '../HistoryTableParts'

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: <T,>({
    children,
    header,
    list,
    onScroll,
    scrollElementRef
  }: {
    children: (item: T, index: number) => ReactNode
    header?: ReactNode
    list: T[]
    onScroll?: () => void
    scrollElementRef?: Ref<HTMLDivElement>
  }) => (
    <div
      data-testid="history-scroller"
      ref={(node) => {
        if (typeof scrollElementRef === 'function') scrollElementRef(node)
        else if (scrollElementRef) {
          const mutableRef = scrollElementRef as { current: HTMLDivElement | null }
          mutableRef.current = node
        }
      }}
      onScroll={onScroll}>
      {header}
      {list.map((item, index) => (
        <div key={index}>{children(item, index)}</div>
      ))}
    </div>
  )
}))

function renderTable(items: number[], onEndReached: () => void) {
  return (
    <HistoryVirtualTable
      emptyContent={null}
      estimateSize={() => 32}
      header={<div>Header</div>}
      items={items}
      onEndReached={onEndReached}
      onFixedActionShadowChange={vi.fn()}
      renderRow={(item) => <div>{item}</div>}
    />
  )
}

describe('HistoryVirtualTable', () => {
  it('fires end reached once until the rendered item count changes', () => {
    const onEndReached = vi.fn()
    const view = render(renderTable([1], onEndReached))
    const scroller = screen.getByTestId('history-scroller')
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 400 }
    })
    scroller.scrollTop = 100

    fireEvent.scroll(scroller)
    fireEvent.scroll(scroller)

    expect(onEndReached).toHaveBeenCalledTimes(1)

    view.rerender(renderTable([1, 2], onEndReached))
    expect(onEndReached).toHaveBeenCalledTimes(2)

    fireEvent.scroll(scroller)
    expect(onEndReached).toHaveBeenCalledTimes(2)
  })
})
