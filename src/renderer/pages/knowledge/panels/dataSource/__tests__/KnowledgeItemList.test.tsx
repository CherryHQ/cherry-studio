import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode, type UIEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type * as UiModule from '@cherrystudio/ui'
import type { KnowledgeItemSort } from '@shared/data/api/schemas/knowledges'

import { nextKnowledgeItemSort } from '../../../utils/itemSort'
import KnowledgeItemList from '../KnowledgeItemList'
import { createFileItem, createNoteItem } from './testUtils'

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof UiModule>()),
  Checkbox: ({
    checked,
    onCheckedChange,
    'aria-label': ariaLabel
  }: {
    checked?: boolean | 'indeterminate'
    onCheckedChange?: (checked: boolean | 'indeterminate') => void
    'aria-label'?: string
  }) => (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked === true}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  )
}))

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: <T,>({
    list,
    children,
    onScroll
  }: {
    list: T[]
    children: (item: T) => ReactNode
    onScroll?: (event: UIEvent<HTMLDivElement>) => void
    getItemKey?: (index: number) => string | number
  }) => {
    return (
      <div data-testid="virtual-list" onScroll={onScroll}>
        {list.map((item, index) => (
          <div key={index}>{children(item)}</div>
        ))}
      </div>
    )
  }
}))

vi.mock('../KnowledgeItemRow', () => ({
  default: ({
    item,
    onClick,
    onDelete,
    onPreviewSource,
    onReindex,
    onViewChunks
  }: {
    item: { id: string; type?: string }
    onClick?: () => void
    onDelete?: () => void
    onPreviewSource?: () => void
    onReindex?: () => void
    onViewChunks?: () => void
  }) => (
    <div>
      <button type="button" onClick={onClick}>
        {item.id}
      </button>
      <button type="button" onClick={onDelete}>
        delete-{item.id}
      </button>
      <button type="button" onClick={onReindex}>
        reindex-{item.id}
      </button>
      <button type="button" onClick={onPreviewSource}>
        preview-{item.id}
      </button>
      <button type="button" onClick={onViewChunks}>
        chunks-{item.id}
      </button>
    </div>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'knowledge.data_source.table.select_all': '全选',
          'knowledge.data_source.table.aria_label': '数据源列表',
          'knowledge.data_source.list.loading_more': '加载更多…',
          'knowledge.data_source.list.end_reached': '没有更多了'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const noopProps = {
  hasMore: false,
  isLoadingMore: false,
  onLoadMore: () => undefined,
  selectedIds: new Set<string>(),
  onToggleOne: () => undefined,
  onToggleAll: () => undefined,
  onActivate: () => undefined,
  onDelete: () => undefined,
  onPreviewSource: () => undefined,
  onReindex: () => undefined,
  onViewChunks: () => undefined
}

// jsdom reports 0 for every scroll dimension, so the scroll handler's bottom-threshold check is
// trivially satisfied unless the geometry is stubbed. Pin it to exercise the real arithmetic.
const setScrollGeometry = (
  node: HTMLElement,
  geometry: { scrollHeight: number; clientHeight: number; scrollTop: number }
) => {
  for (const [key, value] of Object.entries(geometry)) {
    Object.defineProperty(node, key, { value, configurable: true })
  }
}

describe('KnowledgeItemList', () => {
  it('cycles accessible headers, restarts another column and supports keyboard activation', async () => {
    const user = userEvent.setup()
    const Harness = () => {
      const [sort, setSort] = useState<KnowledgeItemSort | null>(null)
      const [isLoading, setIsLoading] = useState(false)
      return (
        <KnowledgeItemList
          items={isLoading ? [] : [createNoteItem({ id: 'note-1' })]}
          isLoading={isLoading}
          {...noopProps}
          sort={sort}
          onSortChange={(column) => {
            setSort((previous) => nextKnowledgeItemSort(previous, column))
            setIsLoading(true)
          }}
        />
      )
    }
    render(<Harness />)
    const name = screen.getByRole('columnheader', { name: 'knowledge.data_source.table.columns.name' })
    const updated = screen.getByRole('columnheader', { name: 'knowledge.data_source.table.columns.updated_at' })
    const nameButton = screen.getByRole('button', { name: 'knowledge.data_source.table.columns.name' })
    await user.click(nameButton)
    expect(name).toHaveAttribute('aria-sort', 'ascending')
    await user.keyboard('{Enter}')
    expect(name).toHaveAttribute('aria-sort', 'descending')
    await user.keyboard(' ')
    expect(name).toHaveAttribute('aria-sort', 'none')
    await user.click(screen.getByRole('button', { name: 'knowledge.data_source.table.columns.updated_at' }))
    expect(updated).toHaveAttribute('aria-sort', 'descending')
    await user.click(nameButton)
    expect(name).toHaveAttribute('aria-sort', 'ascending')
    expect(updated).toHaveAttribute('aria-sort', 'none')
  })

  it('does not request more items when there are no further pages', async () => {
    const handleLoadMore = vi.fn()
    const item = createNoteItem({ id: 'note-1', content: '会议纪要' })

    render(
      <KnowledgeItemList items={[item]} isLoading={false} {...noopProps} hasMore={false} onLoadMore={handleLoadMore} />
    )

    fireEvent.scroll(screen.getByTestId('virtual-list'))
    await Promise.resolve()

    expect(handleLoadMore).not.toHaveBeenCalled()
  })

  it('does not load more when scrolled but still far from the bottom', async () => {
    const handleLoadMore = vi.fn()

    render(
      <KnowledgeItemList
        items={[createNoteItem({ id: 'note-1' })]}
        isLoading={false}
        {...noopProps}
        hasMore
        onLoadMore={handleLoadMore}
      />
    )

    const list = screen.getByTestId('virtual-list')
    setScrollGeometry(list, { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 })
    fireEvent.scroll(list)
    await Promise.resolve()

    expect(handleLoadMore).not.toHaveBeenCalled()
  })

  it('loads more once when scrolled within the bottom threshold, deduping a rapid second scroll', async () => {
    const handleLoadMore = vi.fn()

    render(
      <KnowledgeItemList
        items={[createNoteItem({ id: 'note-1' })]}
        isLoading={false}
        {...noopProps}
        hasMore
        onLoadMore={handleLoadMore}
      />
    )

    const list = screen.getByTestId('virtual-list')
    setScrollGeometry(list, { scrollHeight: 1000, clientHeight: 400, scrollTop: 800 })
    fireEvent.scroll(list)
    fireEvent.scroll(list)

    await vi.waitFor(() => expect(handleLoadMore).toHaveBeenCalledTimes(1))
  })

  it('does not load more while a load-more is already in flight', async () => {
    const handleLoadMore = vi.fn()

    render(
      <KnowledgeItemList
        items={[createNoteItem({ id: 'note-1' })]}
        isLoading={false}
        {...noopProps}
        hasMore
        isLoadingMore
        onLoadMore={handleLoadMore}
      />
    )

    const list = screen.getByTestId('virtual-list')
    setScrollGeometry(list, { scrollHeight: 1000, clientHeight: 400, scrollTop: 800 })
    fireEvent.scroll(list)
    await Promise.resolve()

    expect(handleLoadMore).not.toHaveBeenCalled()
  })

  it('shows a loading indicator while loading more and an end-of-list note once fully paged', () => {
    // More than one page worth of rows (a page is 50), i.e. a multi-page base that has been paged in.
    const items = Array.from({ length: 60 }, (_, index) => createNoteItem({ id: `note-${index}` }))
    const { rerender } = render(
      <KnowledgeItemList items={items} isLoading={false} {...noopProps} hasMore isLoadingMore />
    )

    expect(screen.getByText('加载更多…')).toBeInTheDocument()
    expect(screen.queryByText('没有更多了')).not.toBeInTheDocument()

    // Final page landed: not loading, no more pages, and more than one page is loaded.
    rerender(<KnowledgeItemList items={items} isLoading={false} {...noopProps} hasMore={false} isLoadingMore={false} />)

    expect(screen.getByText('没有更多了')).toBeInTheDocument()
  })

  it('omits the end-of-list note for a single page that never paginated', () => {
    render(
      <KnowledgeItemList items={[createNoteItem({ id: 'note-1' })]} isLoading={false} {...noopProps} hasMore={false} />
    )

    expect(screen.queryByText('没有更多了')).not.toBeInTheDocument()
  })

  it('drops the end-of-list note when switching from a paged base to a single-page base', () => {
    // The list instance is reused across base switches; the note is derived from the live row count
    // (not a sticky ref), so it must not linger when a single-page base replaces a paged-in one.
    const pagedItems = Array.from({ length: 60 }, (_, index) => createNoteItem({ id: `a-${index}` }))
    const { rerender } = render(
      <KnowledgeItemList items={pagedItems} isLoading={false} {...noopProps} hasMore isLoadingMore />
    )

    rerender(
      <KnowledgeItemList items={pagedItems} isLoading={false} {...noopProps} hasMore={false} isLoadingMore={false} />
    )
    expect(screen.getByText('没有更多了')).toBeInTheDocument()

    rerender(
      <KnowledgeItemList
        items={[createNoteItem({ id: 'b-1' })]}
        isLoading={false}
        {...noopProps}
        hasMore={false}
        isLoadingMore={false}
      />
    )
    expect(screen.queryByText('没有更多了')).not.toBeInTheDocument()
  })

  it('exposes grid semantics with column headers', () => {
    render(<KnowledgeItemList items={[createFileItem({ id: 'file-1' })]} isLoading={false} {...noopProps} />)

    expect(screen.getByRole('grid')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').length).toBeGreaterThanOrEqual(5)
  })
})
