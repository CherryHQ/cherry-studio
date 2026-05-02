import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type * as KnowledgeV2Utils from '../../utils'
import DetailHeader from '../DetailHeader'

vi.mock('@renderer/pages/knowledge.v2/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof KnowledgeV2Utils>()

  return {
    ...actual,
    formatRelativeTime: () => '2小时前'
  }
})

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
    ConfirmDialog: ({
      open,
      title,
      description,
      confirmText,
      cancelText,
      onConfirm,
      onOpenChange
    }: {
      open?: boolean
      title: ReactNode
      description?: ReactNode
      confirmText?: string
      cancelText?: string
      onConfirm?: () => void | Promise<void>
      onOpenChange?: (open: boolean) => void
    }) =>
      open ? (
        <div>
          <div>{title}</div>
          {description ? <div>{description}</div> : null}
          <button type="button" onClick={() => onOpenChange?.(false)}>
            {cancelText}
          </button>
          <button
            type="button"
            onClick={() => {
              void onConfirm?.()
            }}>
            {confirmText}
          </button>
        </div>
      ) : null,
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
    PopoverTrigger: ({ children, asChild }: { children: ReactNode; asChild?: boolean }) => {
      const { open, onOpenChange } = React.use(PopoverContext)

      if (asChild && React.isValidElement(children)) {
        const child = children as React.ReactElement<{
          onClick?: (event: React.MouseEvent) => void
        }>

        return React.cloneElement(child, {
          onClick: (event: React.MouseEvent) => {
            child.props.onClick?.(event)
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
    t: (key: string, options?: { count?: number }) =>
      (
        ({
          'common.cancel': '取消',
          'common.delete': '删除',
          'common.more': '更多',
          'knowledge_v2.context.delete': '删除知识库',
          'knowledge_v2.context.delete_confirm_description': '删除后无法恢复',
          'knowledge_v2.context.delete_confirm_title': '确认删除知识库',
          'knowledge_v2.context.rename': '重命名',
          'knowledge_v2.error.failed_base_unknown': '该知识库迁移失败，请重建知识库并选择新的嵌入模型。',
          'knowledge_v2.error.missing_embedding_model':
            '迁移时未找到原知识库使用的嵌入模型，请重建知识库并选择新的嵌入模型。',
          'knowledge_v2.meta.documents_count': `${options?.count ?? 0} 文档`,
          'knowledge_v2.restore.action': '重建知识库',
          'knowledge_v2.status.completed': '就绪',
          'knowledge_v2.status.failed': '失败'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: 'base-1',
  name: 'Base 1',
  groupId: null,
  emoji: '📁',
  dimensions: 1536,
  embeddingModelId: null,
  rerankModelId: undefined,
  fileProcessorId: undefined,
  chunkSize: 1024,
  chunkOverlap: 200,
  threshold: undefined,
  documentCount: undefined,
  status: 'completed',
  error: null,
  searchMode: 'hybrid',
  hybridAlpha: undefined,
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

describe('DetailHeader', () => {
  it('renders the current selected base item count and completed status', () => {
    const { container } = render(
      <DetailHeader
        base={createKnowledgeBase()}
        itemCount={3}
        onRenameBase={vi.fn()}
        onRestoreBase={vi.fn()}
        onDeleteBase={vi.fn()}
      />
    )

    expect(screen.getByText('3 文档')).toBeInTheDocument()
    expect(screen.getByText('就绪')).toBeInTheDocument()
    expect(container.querySelector('.bg-primary')).toHaveAttribute('aria-label', '就绪')
  })

  it('renders the failed status from the base status', () => {
    const { container } = render(
      <DetailHeader
        base={createKnowledgeBase({ status: 'failed', error: 'missing_embedding_model' })}
        itemCount={0}
        onRenameBase={vi.fn()}
        onRestoreBase={vi.fn()}
        onDeleteBase={vi.fn()}
      />
    )

    expect(screen.getByText('失败')).toBeInTheDocument()
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      '迁移时未找到原知识库使用的嵌入模型，请重建知识库并选择新的嵌入模型。'
    )
    expect(container.querySelector('.bg-destructive')).toHaveAttribute('aria-label', '失败')
  })

  it('falls back to a generic failure hint when the failed base has no known error', () => {
    render(
      <DetailHeader
        base={createKnowledgeBase({ status: 'failed', error: null })}
        itemCount={0}
        onRenameBase={vi.fn()}
        onRestoreBase={vi.fn()}
        onDeleteBase={vi.fn()}
      />
    )

    expect(screen.getByRole('tooltip')).toHaveTextContent('该知识库迁移失败，请重建知识库并选择新的嵌入模型。')
  })

  it('shows the restore action only for failed bases and calls onRestoreBase', () => {
    const onRestoreBase = vi.fn()
    const failedBase = createKnowledgeBase({ status: 'failed', error: 'missing_embedding_model' })

    const { rerender } = render(
      <DetailHeader
        base={failedBase}
        itemCount={0}
        onRenameBase={vi.fn()}
        onRestoreBase={onRestoreBase}
        onDeleteBase={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '重建知识库' }))
    expect(onRestoreBase).toHaveBeenCalledWith(failedBase)

    rerender(
      <DetailHeader
        base={createKnowledgeBase()}
        itemCount={0}
        onRenameBase={vi.fn()}
        onRestoreBase={onRestoreBase}
        onDeleteBase={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: '重建知识库' })).not.toBeInTheDocument()
  })

  it('opens the more menu and shows rename and delete actions', () => {
    render(
      <DetailHeader
        base={createKnowledgeBase()}
        itemCount={0}
        onRenameBase={vi.fn()}
        onRestoreBase={vi.fn()}
        onDeleteBase={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '更多' }))

    expect(screen.getByRole('button', { name: '重命名' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除知识库' })).toBeInTheDocument()
  })

  it('calls onRenameBase with the current knowledge base id and name', () => {
    const onRenameBase = vi.fn()

    render(
      <DetailHeader
        base={createKnowledgeBase()}
        itemCount={0}
        onRenameBase={onRenameBase}
        onRestoreBase={vi.fn()}
        onDeleteBase={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))

    expect(onRenameBase).toHaveBeenCalledWith({
      id: 'base-1',
      name: 'Base 1'
    })
  })

  it('opens a delete confirmation dialog and confirms deletion', async () => {
    const onDeleteBase = vi.fn().mockResolvedValue(undefined)

    render(
      <DetailHeader
        base={createKnowledgeBase()}
        itemCount={0}
        onRenameBase={vi.fn()}
        onRestoreBase={vi.fn()}
        onDeleteBase={onDeleteBase}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('button', { name: '删除知识库' }))

    expect(screen.getByText('确认删除知识库')).toBeInTheDocument()
    expect(screen.getByText('删除后无法恢复')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(onDeleteBase).toHaveBeenCalledWith('base-1')
    })
  })
})
