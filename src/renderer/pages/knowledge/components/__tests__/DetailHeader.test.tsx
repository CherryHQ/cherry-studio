import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import DetailHeader from '../DetailHeader'

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const PopoverContext = React.createContext<{
    open: boolean
    onOpenChange?: (open: boolean) => void
  }>({
    open: false
  })

  return {
    Badge: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <span {...props}>{children}</span>
    ),
    Button: ({
      children,
      type = 'button',
      ...props
    }: {
      children: ReactNode
      type?: 'button'
      [key: string]: unknown
    }) => (
      <button type={type} {...props}>
        {children}
      </button>
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
      <button type="button" {...props}>
        {icon}
        {label}
      </button>
    ),
    MenuList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
    t: (key: string, options?: { count?: number; time?: string }) =>
      (
        ({
          'common.cancel': '取消',
          'common.clear': '清除',
          'common.delete': '删除',
          'common.more': '更多',
          'knowledge.context.delete': '删除知识库',
          'knowledge.context.delete_confirm_description': '删除后无法恢复',
          'knowledge.context.delete_confirm_title': '确认删除知识库',
          'knowledge.context.rename': '重命名',
          'knowledge.error.failed_base_unknown': '该知识库迁移失败，请重建知识库并选择新的嵌入模型。',
          'knowledge.error.missing_embedding_model':
            '迁移时未找到原知识库使用的嵌入模型，请重建知识库并选择新的嵌入模型。',
          'knowledge.meta.data_sources_count': `${options?.count ?? 0} 数据源`,
          'knowledge.meta.updated_at': `更新于 ${options?.time ?? ''}`,
          'knowledge.restore.action': '重建知识库',
          'knowledge.status.completed': '就绪',
          'knowledge.status.failed': '失败',
          'knowledge.tabs.rag_config': 'RAG 配置',
          'knowledge.tabs.recall_test': '召回测试'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: 'base-1',
  name: 'Base 1',
  groupId: null,
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
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

describe('DetailHeader', () => {
  it('renders the base name and completed status', () => {
    const { container } = render(
      <DetailHeader
        base={createKnowledgeBase()}
        onOpenRagConfig={vi.fn()}
        onOpenRecallTest={vi.fn()}
        onRenameBase={vi.fn()}
        onDeleteBase={vi.fn()}
      />
    )

    expect(screen.getByText('就绪')).toBeInTheDocument()
    expect(screen.getByText('就绪')).toHaveClass('bg-success/10', 'text-success')
    expect(screen.getByText('就绪')).toHaveAttribute('aria-label', '就绪')

    const detailIcon = container.querySelector('img')
    expect(detailIcon).toBeInTheDocument()
    expect(detailIcon).toHaveClass('size-6')
  })

  it('renders the failed status from the base status', () => {
    render(
      <DetailHeader
        base={createKnowledgeBase({ status: 'failed', error: 'missing_embedding_model' })}
        onOpenRagConfig={vi.fn()}
        onOpenRecallTest={vi.fn()}
        onRenameBase={vi.fn()}
        onDeleteBase={vi.fn()}
      />
    )

    expect(screen.getByText('失败')).toBeInTheDocument()
    expect(screen.getByText('失败')).toHaveClass('bg-destructive/10', 'text-destructive')
    expect(screen.getByText('失败')).toHaveAttribute('aria-label', '失败')
    expect(
      screen.queryByText('迁移时未找到原知识库使用的嵌入模型，请重建知识库并选择新的嵌入模型。')
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重建知识库' })).not.toBeInTheDocument()
  })

  it('does not render the generic failure hint in the header when the failed base has no known error', () => {
    render(
      <DetailHeader
        base={createKnowledgeBase({ status: 'failed', error: null })}
        onOpenRagConfig={vi.fn()}
        onOpenRecallTest={vi.fn()}
        onRenameBase={vi.fn()}
        onDeleteBase={vi.fn()}
      />
    )

    expect(screen.getByText('失败')).toBeInTheDocument()
    expect(screen.queryByText('该知识库迁移失败，请重建知识库并选择新的嵌入模型。')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重建知识库' })).not.toBeInTheDocument()
  })

  it('renders the header actions as icon-only buttons', () => {
    const onOpenRagConfig = vi.fn()
    const onOpenRecallTest = vi.fn()

    render(
      <DetailHeader
        base={createKnowledgeBase()}
        onOpenRagConfig={onOpenRagConfig}
        onOpenRecallTest={onOpenRecallTest}
        onRenameBase={vi.fn()}
        onDeleteBase={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'RAG 配置' }))
    fireEvent.click(screen.getByRole('button', { name: '召回测试' }))

    expect(onOpenRagConfig).toHaveBeenCalledOnce()
    expect(onOpenRecallTest).toHaveBeenCalledOnce()
    expect(screen.queryByText('RAG 配置')).not.toBeInTheDocument()
    expect(screen.getByText('召回测试')).toBeInTheDocument()
  })

  it('opens the more menu and shows rename and delete actions', () => {
    render(
      <DetailHeader
        base={createKnowledgeBase()}
        onOpenRagConfig={vi.fn()}
        onOpenRecallTest={vi.fn()}
        onRenameBase={vi.fn()}
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
        onOpenRagConfig={vi.fn()}
        onOpenRecallTest={vi.fn()}
        onRenameBase={onRenameBase}
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
        onOpenRagConfig={vi.fn()}
        onOpenRecallTest={vi.fn()}
        onRenameBase={vi.fn()}
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
