import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import DetailHeader from '../DetailHeader'

vi.mock('@cherrystudio/ui', () => ({
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
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'zh-CN'
    },
    t: (key: string) =>
      (
        ({
          'knowledge.error.missing_embedding_model':
            '迁移时未找到原知识库使用的嵌入模型，请重建知识库并选择新的嵌入模型。',
          'knowledge.restore.action': '重建知识库',
          'knowledge.status.completed': '就绪',
          'knowledge.status.failed': '失败',
          'knowledge.tabs.rag_config': '知识库设置',
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
  chunkStrategy: 'structured',
  chunkSeparator: '\\n\\n',
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
    render(
      <DetailHeader
        base={createKnowledgeBase()}
        onOpenRagConfig={vi.fn()}
        onOpenRecallTest={vi.fn()}
        onRebuild={vi.fn()}
      />
    )

    expect(screen.getByText('就绪')).toBeInTheDocument()
    expect(screen.getByText('就绪')).toHaveClass('bg-success/10', 'text-success')
    expect(screen.getByText('就绪')).toHaveAttribute('aria-label', '就绪')
  })

  it('renders the failed status as a clickable rebuild trigger', () => {
    const onRebuild = vi.fn()

    render(
      <DetailHeader
        base={createKnowledgeBase({ status: 'failed', error: 'missing_embedding_model' })}
        onOpenRagConfig={vi.fn()}
        onOpenRecallTest={vi.fn()}
        onRebuild={onRebuild}
      />
    )

    expect(screen.getByText('失败')).toBeInTheDocument()
    expect(screen.getByText('失败')).toHaveClass('bg-destructive/10', 'text-destructive')

    const rebuildTrigger = screen.getByRole('button', { name: '失败, 重建知识库' })
    fireEvent.click(rebuildTrigger)
    expect(onRebuild).toHaveBeenCalledOnce()

    // The failure reason itself lives in the rebuild dialog, not the header.
    expect(
      screen.queryByText('迁移时未找到原知识库使用的嵌入模型，请重建知识库并选择新的嵌入模型。')
    ).not.toBeInTheDocument()

    // A failed base cannot be configured or recall-tested, so those actions are hidden.
    expect(screen.queryByRole('button', { name: '知识库设置' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '召回测试' })).not.toBeInTheDocument()
  })

  it('does not expose a rebuild trigger when the base is not failed', () => {
    const onRebuild = vi.fn()

    render(
      <DetailHeader
        base={createKnowledgeBase()}
        onOpenRagConfig={vi.fn()}
        onOpenRecallTest={vi.fn()}
        onRebuild={onRebuild}
      />
    )

    expect(screen.getByText('就绪')).toHaveAttribute('aria-label', '就绪')
    expect(screen.queryByRole('button', { name: /重建知识库/ })).not.toBeInTheDocument()
  })

  it('renders the header actions as icon-only buttons, with no more menu', () => {
    const onOpenRagConfig = vi.fn()
    const onOpenRecallTest = vi.fn()

    render(
      <DetailHeader
        base={createKnowledgeBase()}
        onOpenRagConfig={onOpenRagConfig}
        onOpenRecallTest={onOpenRecallTest}
        onRebuild={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '知识库设置' }))
    fireEvent.click(screen.getByRole('button', { name: '召回测试' }))

    expect(onOpenRagConfig).toHaveBeenCalledOnce()
    expect(onOpenRecallTest).toHaveBeenCalledOnce()
    expect(screen.queryByText('知识库设置')).not.toBeInTheDocument()
    expect(screen.getByText('召回测试')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '更多' })).not.toBeInTheDocument()
  })
})
