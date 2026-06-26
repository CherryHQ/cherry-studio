import '@testing-library/jest-dom/vitest'

import { KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgeItemRow from '../KnowledgeItemRow'
import { createDirectoryItem, createFileItem, createUrlItem } from './testUtils'

const mockUseQuery = vi.fn()

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args)
}))

vi.mock('@renderer/utils/time', () => ({
  formatRelativeTime: () => '刚刚'
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (error: unknown, prefix: string) =>
    `${prefix}: ${error instanceof Error ? error.message : String(error)}`
}))

vi.mock('@cherrystudio/ui', () => ({
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
          'knowledge.data_source.table.view_chunks_row': '查看 Chunks 行',
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
    Object.assign(window, {
      toast: {
        error: vi.fn()
      }
    })
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

  it('does not call onClick for non-completed items', () => {
    const handleClick = vi.fn()

    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs', status: 'processing' })}
        {...defaultHandlers}
        onClick={handleClick}
      />
    )

    fireEvent.click(screen.getByText('https://example.com/product-docs'))

    expect(handleClick).not.toHaveBeenCalled()
  })

  it('exposes a completed row as a focusable element with an accessible name', () => {
    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
      />
    )

    const row = screen.getByRole('row', { name: '查看 Chunks 行' })

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

  it('is not keyboard-activatable for non-completed items', () => {
    const handleClick = vi.fn()

    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs', status: 'processing' })}
        {...defaultHandlers}
        onClick={handleClick}
      />
    )

    const row = screen.getByRole('row')

    expect(row).not.toHaveAttribute('tabindex')

    fireEvent.keyDown(row, { key: 'Enter' })

    expect(handleClick).not.toHaveBeenCalled()
  })

  it('does not render a more button and only reveals actions on right-click', () => {
    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
      />
    )

    expect(screen.queryByRole('button', { name: '更多' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole('row'))

    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()
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
      expect(window.toast.error).toHaveBeenCalledWith('预览原文失败: preview failed')
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
      expect(window.toast.error).toHaveBeenCalledWith('删除数据源失败: delete failed')
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
      expect(window.toast.error).toHaveBeenCalledWith('数据源重新索引失败: reindex failed')
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
