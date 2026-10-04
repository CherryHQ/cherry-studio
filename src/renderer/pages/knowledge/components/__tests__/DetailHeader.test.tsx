import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { KnowledgeBase } from '@shared/data/types/knowledge'

import DetailHeader from '../DetailHeader'

vi.unmock('@cherrystudio/ui')

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
          'knowledge.external.sources.title': '同步来源',
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
  documentCount: undefined,
  status: 'completed',
  error: null,
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

describe('DetailHeader', () => {
  it('renders the base name without a status badge when completed', () => {
    render(
      <DetailHeader
        base={createKnowledgeBase()}
        onOpenRagConfig={vi.fn()}
        onOpenRecallTest={vi.fn()}
        onRebuild={vi.fn()}
      />
    )

    expect(screen.getByText('Base 1')).toBeInTheDocument()
    expect(screen.queryByText('就绪')).not.toBeInTheDocument()
  })

  it('renders the failed status as a clickable rebuild trigger', () => {
    const onRebuild = vi.fn()

    render(
      <DetailHeader
        base={createKnowledgeBase({ status: 'failed', error: 'missing_embedding_model' })}
        onOpenExternalSources={vi.fn()}
        onOpenRagConfig={vi.fn()}
        onOpenRecallTest={vi.fn()}
        onRebuild={onRebuild}
      />
    )

    expect(screen.getByText('失败')).toBeInTheDocument()

    const rebuildTrigger = screen.getByRole('button', { name: '失败, 重建知识库' })
    fireEvent.click(rebuildTrigger)
    expect(onRebuild).toHaveBeenCalledOnce()

    // The failure reason itself lives in the rebuild dialog, not the header.
    expect(
      screen.queryByText('迁移时未找到原知识库使用的嵌入模型，请重建知识库并选择新的嵌入模型。')
    ).not.toBeInTheDocument()

    // A failed base cannot be configured or recall-tested, so those actions are hidden.
    expect(screen.queryByRole('button', { name: '知识库设置' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '同步来源' })).not.toBeInTheDocument()
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

    expect(screen.queryByText('就绪')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /重建知识库/ })).not.toBeInTheDocument()
  })

  it('opens source management from an accessible icon button and hides it outside the base root', async () => {
    const user = userEvent.setup()
    const onOpenExternalSources = vi.fn()
    const props = {
      base: createKnowledgeBase(),
      onOpenRagConfig: vi.fn(),
      onOpenRecallTest: vi.fn(),
      onRebuild: vi.fn()
    }
    const { rerender } = render(<DetailHeader {...props} onOpenExternalSources={onOpenExternalSources} />)

    const manage = screen.getByRole('button', { name: '同步来源' })
    expect(manage).toHaveTextContent(/^$/)
    await user.tab()
    await user.tab()
    expect(manage).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onOpenExternalSources).toHaveBeenCalledOnce()
    await user.hover(manage)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('同步来源')

    rerender(<DetailHeader {...props} />)
    expect(screen.queryByRole('button', { name: '同步来源' })).not.toBeInTheDocument()
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
