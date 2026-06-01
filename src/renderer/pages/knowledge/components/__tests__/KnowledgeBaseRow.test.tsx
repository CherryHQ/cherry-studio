import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'
import type { Group } from '@shared/data/types/group'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import KnowledgeBaseRow from '../navigator/KnowledgeBaseRow'

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
  ConfirmDialog: () => null,
  MenuDivider: () => <hr />,
  MenuItem: ({ icon, label, ...props }: { icon?: ReactNode; label: string; [key: string]: unknown }) => (
    <button type="button" {...props}>
      {icon}
      {label}
    </button>
  ),
  MenuList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverAnchor: () => null,
  PopoverContent: () => null
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'zh-CN'
    },
    t: (key: string, options?: { count?: number }) =>
      (
        ({
          'common.more': '更多',
          'knowledge.context.delete': '删除知识库',
          'knowledge.context.move_to': '移动到',
          'knowledge.context.rename': '重命名',
          'knowledge.meta.documents_count': `${options?.count ?? 0} 文档`,
          'knowledge.status.completed': '就绪',
          'knowledge.status.failed': '失败'
        }) as Record<string, string>
      )[key] ?? key
  })
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBaseListItem> = {}): KnowledgeBaseListItem => ({
  id: 'base-1',
  name: 'Base 1',
  itemCount: 0,
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
  hybridAlpha: undefined,
  createdAt: '2026-04-15T09:00:00+08:00',
  updatedAt: '2026-04-15T09:00:00+08:00',
  ...overrides
})

const createGroup = (overrides: Partial<Group> = {}): Group => ({
  id: 'group-1',
  entityType: 'knowledge',
  name: 'Research',
  orderKey: 'a0',
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
  ...overrides
})

describe('KnowledgeBaseRow', () => {
  it('renders the base name and completed status dot without updated time', () => {
    const { container } = render(
      <KnowledgeBaseRow
        base={createKnowledgeBase()}
        groups={[createGroup()]}
        selected={false}
        onSelectBase={vi.fn()}
        onMoveBase={vi.fn()}
        onRenameBase={vi.fn()}
        onDeleteBase={vi.fn()}
      />
    )

    expect(screen.getByText('Base 1')).toBeInTheDocument()
    expect(screen.queryByText('2小时前')).not.toBeInTheDocument()
    expect(screen.getByText('0 文档')).toBeInTheDocument()
    expect(container.querySelector('[aria-label="就绪"]')).toBeInTheDocument()
  })

  it('renders the failed status dot from the base status', () => {
    const { container } = render(
      <KnowledgeBaseRow
        base={createKnowledgeBase({ status: 'failed', error: 'missing_embedding_model' })}
        groups={[createGroup()]}
        selected={false}
        onSelectBase={vi.fn()}
        onMoveBase={vi.fn()}
        onRenameBase={vi.fn()}
        onDeleteBase={vi.fn()}
      />
    )

    expect(container.querySelector('.bg-destructive')).toHaveAttribute('aria-label', '失败')
  })

  it('uses the reference two-line layout with a large selected row', () => {
    const { container } = render(
      <KnowledgeBaseRow
        base={createKnowledgeBase({ itemCount: 10 })}
        groups={[createGroup()]}
        selected
        onSelectBase={vi.fn()}
        onMoveBase={vi.fn()}
        onRenameBase={vi.fn()}
        onDeleteBase={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /Base 1/ })).toHaveClass('min-h-11', 'rounded-xl', 'bg-secondary')
    expect(screen.getByText('Base 1')).toHaveClass('text-sm', 'font-medium')
    expect(screen.getByText('10 文档').parentElement).toHaveClass('text-xs', 'text-foreground-muted')
    expect(container.querySelector('img')).toBeInTheDocument()
  })
})
