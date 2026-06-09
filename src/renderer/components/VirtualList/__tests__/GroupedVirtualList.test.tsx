import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useVirtualizer: vi.fn((options: { count: number; estimateSize: (index: number) => number }) => ({
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: `row-${index}`,
        start: index * 40,
        size: 40
      })),
    getTotalSize: () => options.count * 40,
    getVirtualIndexes: vi.fn(() => Array.from({ length: options.count }, (_, index) => index)),
    measure: vi.fn(),
    measureElement: vi.fn(),
    resizeItem: vi.fn(),
    scrollElement: null,
    scrollToIndex: vi.fn(),
    scrollToOffset: vi.fn()
  }))
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: mocks.useVirtualizer,
  defaultRangeExtractor: vi.fn((range) =>
    Array.from({ length: range.endIndex - range.startIndex + 1 }, (_, i) => range.startIndex + i)
  )
}))

import { GroupedVirtualList } from '..'

type TestGroup = {
  id: string
}

type TestItem = {
  id: string
  label: string
}

describe('GroupedVirtualList', () => {
  it('flattens group headers, items, and footers into one virtual list', () => {
    render(
      <GroupedVirtualList
        role="listbox"
        groups={[
          {
            group: { id: 'first' },
            header: 'First',
            items: [{ id: 'a', label: 'Alpha' }],
            footer: 'First footer'
          },
          {
            group: { id: 'second' },
            items: [
              { id: 'b', label: 'Beta' },
              { id: 'c', label: 'Gamma' }
            ]
          }
        ]}
        estimateGroupHeaderSize={() => 24}
        estimateItemSize={() => 40}
        estimateGroupFooterSize={() => 32}
        renderGroupHeader={(header) => <div>Header {header}</div>}
        renderItem={(item, itemIndex, group, groupIndex, itemIndexInGroup) => (
          <div>
            Item {item.label} global {itemIndex} local {itemIndexInGroup} group {group.id} rank {groupIndex}
          </div>
        )}
        renderGroupFooter={(footer) => <div>Footer {footer}</div>}
      />
    )

    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByText('Header First')).toBeInTheDocument()
    expect(screen.getByText('Item Alpha global 0 local 0 group first rank 0')).toBeInTheDocument()
    expect(screen.getByText('Footer First footer')).toBeInTheDocument()
    expect(screen.getByText('Item Beta global 1 local 0 group second rank 1')).toBeInTheDocument()
    expect(screen.getByText('Item Gamma global 2 local 1 group second rank 1')).toBeInTheDocument()
    expect(mocks.useVirtualizer).toHaveBeenLastCalledWith(expect.objectContaining({ count: 5 }))
  })

  it('uses row-specific size estimators', () => {
    const estimateGroupHeaderSize = vi.fn(() => 24)
    const estimateItemSize = vi.fn(() => 40)
    const estimateGroupFooterSize = vi.fn(() => 32)

    render(
      <GroupedVirtualList<TestGroup, TestItem, string, string>
        groups={[
          {
            group: { id: 'first' },
            header: 'First',
            items: [{ id: 'a', label: 'Alpha' }],
            footer: 'First footer'
          }
        ]}
        estimateGroupHeaderSize={estimateGroupHeaderSize}
        estimateItemSize={estimateItemSize}
        estimateGroupFooterSize={estimateGroupFooterSize}
        renderGroupHeader={(header) => <div>{header}</div>}
        renderItem={(item) => <div>{item.label}</div>}
        renderGroupFooter={(footer) => <div>{footer}</div>}
      />
    )

    const options = mocks.useVirtualizer.mock.calls.at(-1)?.[0]
    if (!options) {
      throw new Error('Expected useVirtualizer to be called')
    }

    expect(options.estimateSize(0)).toBe(24)
    expect(options.estimateSize(1)).toBe(40)
    expect(options.estimateSize(2)).toBe(32)
    expect(estimateGroupHeaderSize).toHaveBeenCalledWith('First', { id: 'first' }, 0)
    expect(estimateItemSize).toHaveBeenCalledWith({ id: 'a', label: 'Alpha' }, 0, { id: 'first' }, 0, 0)
    expect(estimateGroupFooterSize).toHaveBeenCalledWith('First footer', { id: 'first' }, 0)
  })
})
