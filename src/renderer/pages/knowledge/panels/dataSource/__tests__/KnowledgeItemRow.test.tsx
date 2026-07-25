import '@testing-library/jest-dom/vitest'

import { toast } from '@renderer/services/toast'
import { KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgeItemRow from '../KnowledgeItemRow'
import { createDirectoryItem, createFileItem, createNoteItem, createUrlItem } from './testUtils'

const mockUseQuery = vi.fn()
const mockUseSharedCacheValue = vi.fn()

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args)
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useSharedCacheValue: (...args: unknown[]) => mockUseSharedCacheValue(...args)
}))

vi.mock('@renderer/utils/time', () => ({
  formatRelativeTime: () => '刚刚'
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (error: unknown, prefix: string) =>
    `${prefix}: ${error instanceof Error ? error.message : String(error)}`
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    type = 'button',
    ...props
  }: {
    children: ReactNode
    type?: 'button' | 'submit' | 'reset'
    [key: string]: unknown
  }) => (
    <button type={type} {...props}>
      {children}
    </button>
  ),
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
  ),
  NormalTooltip: ({ children, content }: { children: ReactNode; content?: ReactNode }) => (
    <span>
      {children}
      {content ? <span role="tooltip">{content}</span> : null}
    </span>
  )
}))

// The row's actions live behind a whole-row right-click menu (CommandContextMenu). Stub it as a
// wrapper that opens on contextMenu and renders the `extraItems` as plain buttons so tests can
// open the menu with a right-click and click an action.
type StubExtraItem = {
  type: 'item' | 'submenu' | 'separator'
  id?: string
  label?: string
  destructive?: boolean
  onSelect?: () => void
}

vi.mock('@renderer/components/command', async () => {
  const React = await import('react')

  return {
    CommandContextMenu: ({
      children,
      extraItems = [],
      onOpenChange
    }: {
      children: ReactNode
      extraItems?: StubExtraItem[]
      onOpenChange?: (open: boolean) => void
    }) => {
      const [open, setOpen] = React.useState(false)

      return (
        <>
          <div
            onContextMenu={(event) => {
              event.preventDefault()
              setOpen(true)
              onOpenChange?.(true)
            }}>
            {children}
          </div>
          {open ? (
            <div role="menu">
              {extraItems
                .filter((item) => item.type === 'item')
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      item.onSelect?.()
                      setOpen(false)
                      onOpenChange?.(false)
                    }}>
                    {item.label}
                  </button>
                ))}
            </div>
          ) : null}
        </>
      )
    },
    // The hover "more" button opens the same item model on click. Stub it as a toggle on the
    // trigger (mirroring the real asChild) so tests can open the menu and click an action.
    CommandPopupMenu: ({ children, extraItems = [] }: { children: ReactNode; extraItems?: StubExtraItem[] }) => {
      const [open, setOpen] = React.useState(false)
      const trigger = React.isValidElement(children)
        ? // eslint-disable-next-line @eslint-react/no-clone-element -- Mirrors CommandPopupMenu's asChild trigger path.
          React.cloneElement(children as React.ReactElement<{ onClick?: (event: unknown) => void }>, {
            onClick: (event: unknown) => {
              ;(children.props as { onClick?: (event: unknown) => void }).onClick?.(event)
              setOpen((value) => !value)
            }
          })
        : children

      return (
        <>
          {trigger}
          {open ? (
            <div role="menu">
              {extraItems
                .filter((item) => item.type === 'item')
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      item.onSelect?.()
                      setOpen(false)
                    }}>
                    {item.label}
                  </button>
                ))}
            </div>
          ) : null}
        </>
      )
    }
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'zh-CN'
    },
    t: (key: string) =>
      (
        ({
          'knowledge.data_source.status.ready': '就绪',
          'knowledge.data_source.status.error': '失败',
          'knowledge.error.directory_not_migrated': '该文件夹内容迁移失败，请删除后重新上传。',
          'knowledge.data_source.status.embedding': '向量化中',
          'knowledge.data_source.status.chunking': '分块中',
          'knowledge.data_source.status.pending': '等待中',
          'knowledge.data_source.actions.preview_source': '预览原文',
          'knowledge.data_source.actions.view_chunks': '查看 Chunks',
          'knowledge.data_source.actions.reindex': '重新索引',
          'knowledge.data_source.actions.delete': '删除',
          'knowledge.data_source.delete_failed': '删除数据源失败',
          'knowledge.data_source.preview.failed': '预览原文失败',
          'knowledge.data_source.reindex_failed': '数据源重新索引失败',
          'knowledge.data_source.filters.file': '文件',
          'knowledge.data_source.filters.note': '笔记',
          'knowledge.data_source.filters.directory': '目录',
          'knowledge.data_source.filters.url': '链接',
          'knowledge.data_source.table.select_row': '选择行',
          'knowledge.data_source.table.open_row': '打开行',
          'common.more': '更多',
          'knowledge.rag.file_processing': '文件处理'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const defaultHandlers = {
  selected: false,
  onToggleSelect: () => undefined,
  onClick: () => undefined,
  onDelete: () => undefined,
  onPreviewSource: () => undefined,
  onReindex: () => undefined,
  onViewChunks: () => undefined
}

describe('KnowledgeItemRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: undefined
    })
    mockUseSharedCacheValue.mockReturnValue(undefined)
  })

  it('renders the file title from the knowledge item path', () => {
    render(<KnowledgeItemRow item={createFileItem({ id: 'file-1', originName: 'old-name.md' })} {...defaultHandlers} />)

    expect(screen.getByText('old-name.md')).toBeInTheDocument()
    expect(screen.getByText('文件')).toBeInTheDocument()
    expect(screen.getByText('刚刚')).toBeInTheDocument()
    expect(mockUseQuery).not.toHaveBeenCalledWith('/files/entries/:id', expect.anything())
  })

  it('falls back to the file source when the file entry is not loaded', () => {
    render(
      <KnowledgeItemRow item={createFileItem({ id: 'file-1', source: '/tmp/fallback.md' })} {...defaultHandlers} />
    )

    expect(screen.getByText('fallback.md')).toBeInTheDocument()
    expect(screen.getByText('文件')).toBeInTheDocument()
  })

  it('renders the completed status label for ready items', () => {
    render(<KnowledgeItemRow item={createFileItem({ id: 'file-1', status: 'completed' })} {...defaultHandlers} />)

    expect(screen.getByText('就绪')).toBeInTheDocument()
  })

  it('renders the failed status label for failed items', () => {
    render(<KnowledgeItemRow item={createFileItem({ id: 'file-1', status: 'failed' })} {...defaultHandlers} />)

    expect(screen.getByText('失败')).toBeInTheDocument()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Indexing failed')
  })

  it('renders a not-migrated directory as a red failure, reindexable but not chunk-viewable', () => {
    render(
      <KnowledgeItemRow
        item={createDirectoryItem({
          id: 'directory-1',
          status: 'failed',
          error: KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED
        })}
        {...defaultHandlers}
      />
    )

    // Red failure label with the localized migration-failed tooltip.
    expect(screen.getByText('失败')).toBeInTheDocument()
    expect(screen.getByRole('tooltip')).toHaveTextContent('该文件夹内容迁移失败')

    // Re-indexing restores the index, but there are no chunks to view yet.
    fireEvent.contextMenu(screen.getByRole('row'))
    expect(screen.getByRole('button', { name: '重新索引' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看 Chunks' })).not.toBeInTheDocument()
  })

  it('renders the processing status label for in-flight items', () => {
    render(<KnowledgeItemRow item={createFileItem({ id: 'file-1', status: 'reading' })} {...defaultHandlers} />)

    expect(screen.getByText('文件处理')).toBeInTheDocument()
  })

  it('shows the embedding percentage next to the status label while embedding', () => {
    mockUseSharedCacheValue.mockReturnValue(42)

    render(<KnowledgeItemRow item={createFileItem({ id: 'file-1', status: 'embedding' })} {...defaultHandlers} />)

    expect(mockUseSharedCacheValue).toHaveBeenCalledWith('knowledge.item.embedding_progress.file-1')
    expect(screen.getByText('向量化中 42%')).toBeInTheDocument()
  })

  it('shows the bare embedding label while the job has not published a percentage yet', () => {
    // Read-only subscription: an absent key reads as undefined (e.g. before the
    // first batch lands, or for a run that reuses every stored vector).
    mockUseSharedCacheValue.mockReturnValue(undefined)

    render(<KnowledgeItemRow item={createFileItem({ id: 'file-1', status: 'embedding' })} {...defaultHandlers} />)

    expect(screen.getByText('向量化中')).toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('does not subscribe to the progress key at all for non-embedding rows', () => {
    // The subscription lives in a child only mounted while embedding, so ordinary
    // completed/failed rows never touch (or create) the shared-cache key.
    mockUseSharedCacheValue.mockReturnValue(42)

    render(<KnowledgeItemRow item={createFileItem({ id: 'file-1', status: 'completed' })} {...defaultHandlers} />)

    expect(screen.getByText('就绪')).toBeInTheDocument()
    expect(screen.queryByText(/42%/)).not.toBeInTheDocument()
    expect(mockUseSharedCacheValue).not.toHaveBeenCalled()
  })

  it('calls onClick when the row is clicked', () => {
    const handleClick = vi.fn()

    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
        onClick={handleClick}
      />
    )

    fireEvent.click(screen.getByText('https://example.com/product-docs'))

    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('does not activate a non-completed note (no external target until its chunk view is ready)', () => {
    const handleClick = vi.fn()

    render(
      <KnowledgeItemRow
        item={createNoteItem({ id: 'note-1', status: 'processing' })}
        {...defaultHandlers}
        onClick={handleClick}
      />
    )

    fireEvent.click(screen.getByRole('row'))

    expect(handleClick).not.toHaveBeenCalled()
  })

  it.each(['processing', 'failed'] as const)(
    'activates a non-completed url row (%s) so its source can be opened regardless of index state',
    (status) => {
      const handleClick = vi.fn()

      render(
        <KnowledgeItemRow
          item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs', status })}
          {...defaultHandlers}
          onClick={handleClick}
        />
      )

      fireEvent.click(screen.getByText('https://example.com/product-docs'))

      expect(handleClick).toHaveBeenCalledTimes(1)
    }
  )

  it('exposes a completed row as a focusable element with an accessible name', () => {
    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
      />
    )

    const row = screen.getByRole('row', { name: '打开行' })

    expect(row).toHaveAttribute('tabindex', '0')
  })

  it.each(['Enter', ' '])('calls onClick when %s is pressed on a completed row', (key) => {
    const handleClick = vi.fn()

    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
        onClick={handleClick}
      />
    )

    fireEvent.keyDown(screen.getByRole('row'), { key })

    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('does not call onClick when a key bubbles up from a control inside the row', () => {
    const handleClick = vi.fn()

    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
        onClick={handleClick}
      />
    )

    fireEvent.keyDown(screen.getByRole('checkbox', { name: '选择行' }), { key: 'Enter' })

    expect(handleClick).not.toHaveBeenCalled()
  })

  it('toggles selection without opening the row when the checkbox column is clicked', () => {
    const handleClick = vi.fn()
    const handleToggle = vi.fn()

    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
        onClick={handleClick}
        onToggleSelect={handleToggle}
      />
    )

    fireEvent.click(screen.getByRole('checkbox', { name: '选择行' }))

    expect(handleToggle).toHaveBeenCalledWith(true)
    expect(handleClick).not.toHaveBeenCalled()
  })

  it('is not keyboard-activatable for a non-completed note', () => {
    const handleClick = vi.fn()

    render(
      <KnowledgeItemRow
        item={createNoteItem({ id: 'note-1', status: 'processing' })}
        {...defaultHandlers}
        onClick={handleClick}
      />
    )

    const row = screen.getByRole('row')

    expect(row).not.toHaveAttribute('tabindex')

    fireEvent.keyDown(row, { key: 'Enter' })

    expect(handleClick).not.toHaveBeenCalled()
  })

  it('reveals the same actions via the more button and right-click', () => {
    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
      />
    )

    // The more button is always mounted (revealed on hover via CSS); its menu is closed at rest.
    expect(screen.getByRole('button', { name: '更多' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()

    // Clicking the more button opens the same actions as a right-click on the row.
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.contextMenu(screen.getByRole('row'))
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()
  })

  it('does not activate the row when a more-menu action is clicked', () => {
    const handleClick = vi.fn()
    const handlePreviewSource = vi.fn()

    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
        onClick={handleClick}
        onPreviewSource={handlePreviewSource}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('button', { name: '预览原文' }))

    expect(handlePreviewSource).toHaveBeenCalledTimes(1)
    expect(handleClick).not.toHaveBeenCalled()
  })

  it('does not open the row when it is right-clicked', () => {
    const handleClick = vi.fn()

    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
        onClick={handleClick}
      />
    )

    fireEvent.contextMenu(screen.getByRole('row'))

    expect(handleClick).not.toHaveBeenCalled()
  })

  it('opens the context menu with placeholder actions', () => {
    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
      />
    )

    fireEvent.contextMenu(screen.getByRole('row'))

    expect(screen.getByRole('button', { name: '预览原文' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看 Chunks' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新索引' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()
  })

  it('does not call onClick when a more menu action is clicked', () => {
    const handleClick = vi.fn()

    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
        onClick={handleClick}
      />
    )

    fireEvent.contextMenu(screen.getByRole('row'))
    fireEvent.click(screen.getByRole('button', { name: '预览原文' }))

    expect(handleClick).not.toHaveBeenCalled()
  })

  it('calls onPreviewSource without calling onClick when the preview source action is clicked', async () => {
    const handleClick = vi.fn()
    const handlePreviewSource = vi.fn()

    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
        onClick={handleClick}
        onPreviewSource={handlePreviewSource}
      />
    )

    fireEvent.contextMenu(screen.getByRole('row'))
    fireEvent.click(screen.getByRole('button', { name: '预览原文' }))

    await waitFor(() => {
      expect(handlePreviewSource).toHaveBeenCalledTimes(1)
    })
    expect(handleClick).not.toHaveBeenCalled()
  })

  it('shows a failure toast when preview source rejects', async () => {
    const handlePreviewSource = vi.fn().mockRejectedValue(new Error('preview failed'))

    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
        onPreviewSource={handlePreviewSource}
      />
    )

    fireEvent.contextMenu(screen.getByRole('row'))
    fireEvent.click(screen.getByRole('button', { name: '预览原文' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('预览原文失败: preview failed')
    })
  })

  it('calls onViewChunks without calling onClick when the view chunks action is clicked', () => {
    const handleClick = vi.fn()
    const handleViewChunks = vi.fn()

    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
        onClick={handleClick}
        onViewChunks={handleViewChunks}
      />
    )

    fireEvent.contextMenu(screen.getByRole('row'))
    fireEvent.click(screen.getByRole('button', { name: '查看 Chunks' }))

    expect(handleViewChunks).toHaveBeenCalledTimes(1)
    expect(handleClick).not.toHaveBeenCalled()
  })

  it.each(['idle', 'processing', 'reading', 'embedding', 'failed', 'deleting'] as const)(
    'hides view chunks for %s leaf items',
    (status) => {
      render(<KnowledgeItemRow item={createUrlItem({ id: `url-${status}`, status })} {...defaultHandlers} />)

      fireEvent.contextMenu(screen.getByRole('row'))

      expect(screen.queryByRole('button', { name: '查看 Chunks' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()
    }
  )

  it('calls onDelete without calling onClick when the delete action is clicked', async () => {
    const handleClick = vi.fn()
    const handleDelete = vi.fn()

    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
        onClick={handleClick}
        onDelete={handleDelete}
      />
    )

    fireEvent.contextMenu(screen.getByRole('row'))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(handleDelete).toHaveBeenCalledTimes(1)
    })
    expect(handleClick).not.toHaveBeenCalled()
  })

  it('shows a failure toast when delete rejects', async () => {
    const handleDelete = vi.fn().mockRejectedValue(new Error('delete failed'))

    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
        onDelete={handleDelete}
      />
    )

    fireEvent.contextMenu(screen.getByRole('row'))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('删除数据源失败: delete failed')
    })
  })

  it('calls onReindex without calling onClick when the reindex action is clicked', async () => {
    const handleClick = vi.fn()
    const handleReindex = vi.fn()

    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
        onClick={handleClick}
        onReindex={handleReindex}
      />
    )

    fireEvent.contextMenu(screen.getByRole('row'))
    fireEvent.click(screen.getByRole('button', { name: '重新索引' }))

    await waitFor(() => {
      expect(handleReindex).toHaveBeenCalledTimes(1)
    })
    expect(handleClick).not.toHaveBeenCalled()
  })

  it('shows a failure toast when reindex rejects', async () => {
    const handleReindex = vi.fn().mockRejectedValue(new Error('reindex failed'))

    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
        onReindex={handleReindex}
      />
    )

    fireEvent.contextMenu(screen.getByRole('row'))
    fireEvent.click(screen.getByRole('button', { name: '重新索引' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('数据源重新索引失败: reindex failed')
    })
  })

  it.each(['completed', 'failed'] as const)('shows reindex for %s items', (status) => {
    render(<KnowledgeItemRow item={createUrlItem({ id: `url-${status}`, status })} {...defaultHandlers} />)

    fireEvent.contextMenu(screen.getByRole('row'))

    expect(screen.getByRole('button', { name: '重新索引' })).toBeInTheDocument()
  })

  it.each(['idle', 'processing', 'reading', 'embedding', 'deleting'] as const)(
    'hides reindex for %s leaf items',
    (status) => {
      render(<KnowledgeItemRow item={createUrlItem({ id: `url-${status}`, status })} {...defaultHandlers} />)

      fireEvent.contextMenu(screen.getByRole('row'))

      expect(screen.queryByRole('button', { name: '重新索引' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()
    }
  )
})
