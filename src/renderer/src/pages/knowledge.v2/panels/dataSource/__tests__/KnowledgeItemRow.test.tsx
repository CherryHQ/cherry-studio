import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import KnowledgeItemRow from '../KnowledgeItemRow'
import { createFileItem, createUrlItem } from './testUtils'

vi.mock('@renderer/pages/knowledge.v2/utils', () => ({
  formatKnowledgeActionError: (error: unknown, prefix: string) =>
    `${prefix}: ${error instanceof Error ? error.message : String(error)}`,
  formatRelativeTime: () => '刚刚'
}))

vi.mock('@renderer/utils', () => ({
  formatFileSize: () => '1 KB'
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const PopoverContext = React.createContext<{
    open: boolean
    onOpenChange?: (open: boolean) => void
  }>({
    open: false
  })

  return {
    Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <button {...props}>{children}</button>
    ),
    MenuItem: ({ icon, label, ...props }: { icon?: ReactNode; label: string; [key: string]: unknown }) => (
      <button {...props}>
        {icon}
        {label}
      </button>
    ),
    MenuList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    NormalTooltip: ({ children, content }: { children: ReactNode; content?: ReactNode }) => (
      <span>
        {children}
        {content ? <span role="tooltip">{content}</span> : null}
      </span>
    ),
    Popover: ({
      children,
      open,
      onOpenChange
    }: {
      children: ReactNode
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) => <PopoverContext value={{ open: Boolean(open), onOpenChange }}>{children}</PopoverContext>,
    PopoverContent: ({ children }: { children: ReactNode }) => {
      const { open } = React.use(PopoverContext)

      return open ? <div>{children}</div> : null
    },
    PopoverTrigger: ({
      children,
      asChild,
      onClick
    }: {
      children: ReactNode
      asChild?: boolean
      onClick?: (event: React.MouseEvent) => void
    }) => {
      const { open, onOpenChange } = React.use(PopoverContext)

      if (asChild && React.isValidElement(children)) {
        const child = children as React.ReactElement<{
          onClick?: (event: React.MouseEvent) => void
        }>

        return React.cloneElement(child, {
          onClick: (event: React.MouseEvent) => {
            child.props.onClick?.(event)
            onClick?.(event)
            onOpenChange?.(!open)
          }
        })
      }

      return (
        <button type="button" onClick={() => onOpenChange?.(!open)}>
          {children}
        </button>
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
          'knowledge_v2.data_source.status.ready': '就绪',
          'knowledge_v2.data_source.status.error': '失败',
          'knowledge_v2.data_source.status.embedding': '向量化中',
          'knowledge_v2.data_source.status.chunking': '分块中',
          'knowledge_v2.data_source.status.pending': '等待中',
          'knowledge_v2.data_source.actions.preview_source': '预览原文',
          'knowledge_v2.data_source.actions.view_chunks': '查看 Chunks',
          'knowledge_v2.data_source.actions.reindex': '重新索引',
          'knowledge_v2.data_source.actions.delete': '删除',
          'knowledge_v2.data_source.reindex_failed': '数据源重新索引失败',
          'common.more': '更多',
          'knowledge_v2.rag.file_processing': '文件处理'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const defaultHandlers = {
  onClick: () => undefined,
  onDelete: () => undefined,
  onPreviewSource: () => undefined,
  onReindex: () => undefined,
  onViewChunks: () => undefined
}

describe('KnowledgeItemRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, {
      toast: {
        error: vi.fn()
      }
    })
  })

  it('renders the file suffix and meta parts from the row view model', () => {
    render(
      <KnowledgeItemRow
        item={createFileItem({ id: 'file-1', originName: '季度报告.pdf', ext: 'PDF' })}
        {...defaultHandlers}
      />
    )

    expect(screen.getByText('季度报告.pdf')).toBeInTheDocument()
    expect(screen.getByText('pdf')).toBeInTheDocument()
    expect(screen.getByText('1 KB')).toBeInTheDocument()
    expect(screen.getByText('刚刚')).toBeInTheDocument()
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

  it('renders the processing status label for in-flight items', () => {
    render(
      <KnowledgeItemRow
        item={createFileItem({ id: 'file-1', status: 'processing', phase: 'reading' })}
        {...defaultHandlers}
      />
    )

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

  it('renders the more button', () => {
    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
      />
    )

    expect(screen.getByRole('button', { name: '更多' })).toBeInTheDocument()
  })

  it('does not call onClick when the more button is clicked', () => {
    const handleClick = vi.fn()

    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
        onClick={handleClick}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '更多' }))

    expect(handleClick).not.toHaveBeenCalled()
  })

  it('opens the more menu with placeholder actions', () => {
    render(
      <KnowledgeItemRow
        item={createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })}
        {...defaultHandlers}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '更多' }))

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

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('button', { name: '预览原文' }))

    expect(handleClick).not.toHaveBeenCalled()
  })

  it('calls onPreviewSource without calling onClick when the preview source action is clicked', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('button', { name: '查看 Chunks' }))

    expect(handleViewChunks).toHaveBeenCalledTimes(1)
    expect(handleClick).not.toHaveBeenCalled()
  })

  it('calls onDelete without calling onClick when the delete action is clicked', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    expect(handleDelete).toHaveBeenCalledTimes(1)
    expect(handleClick).not.toHaveBeenCalled()
  })

  it('calls onReindex without calling onClick when the reindex action is clicked', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('button', { name: '重新索引' }))

    expect(handleReindex).toHaveBeenCalledTimes(1)
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

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('button', { name: '重新索引' }))

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('数据源重新索引失败: reindex failed')
    })
  })
})
