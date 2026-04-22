import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import BaseNavigator from '../BaseNavigator'

vi.mock('@cherrystudio/ui', () => ({
  Accordion: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AccordionContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AccordionItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AccordionTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <button {...props}>{children}</button>
  ),
  Input: (props: Record<string, unknown>) => <input {...props} />,
  Scrollbar: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      (
        ({
          'knowledge_v2.title': '知识库',
          'knowledge_v2.add.title': '新建知识库',
          'knowledge_v2.search': '搜索知识库',
          'knowledge_v2.empty': '暂无知识库',
          'knowledge_v2.groups.ungrouped': '未分组',
          'knowledge_v2.groups.personal': '个人'
        }) as Record<string, string>
      )[key] ?? (typeof options?.count === 'number' ? `${options.count}` : key)
  })
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: '',
  name: '',
  description: undefined,
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
  searchMode: undefined,
  hybridAlpha: undefined,
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

describe('BaseNavigator', () => {
  it('shows the raw groupId when a knowledge base belongs to a group', () => {
    render(
      <BaseNavigator
        bases={[createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'personal' })]}
        width={280}
        selectedBaseId="base-1"
        onSelectBase={vi.fn()}
        onCreateBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    expect(screen.getByText('personal')).toBeInTheDocument()
    expect(screen.queryByText('个人')).not.toBeInTheDocument()
  })

  it('falls back to the ungrouped label when groupId is missing', () => {
    render(
      <BaseNavigator
        bases={[createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: null })]}
        width={280}
        selectedBaseId="base-1"
        onSelectBase={vi.fn()}
        onCreateBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    expect(screen.getByText('未分组')).toBeInTheDocument()
  })
})
