import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'
import type { Group } from '@shared/data/types/group'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import KnowledgeBaseRow from '../navigator/KnowledgeBaseRow'

vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  CommandPopupMenu: ({ children }: { children: ReactNode }) => <>{children}</>
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
  ConfirmDialog: () => null,
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, ...props }: { children: ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={onSelect} {...props}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
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
  PopoverContent: () => null,
  PopoverTrigger: ({ children }: { children: ReactNode }) => children
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
    const statusDot = container.querySelector('[aria-label="就绪"]')
    expect(statusDot).toBeInTheDocument()
    expect(statusDot).not.toHaveAttribute('title')
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

    expect(screen.getByRole('button', { name: /Base 1/ }).parentElement).toHaveClass(
      'min-h-11',
      'rounded-xl',
      'bg-secondary'
    )
    expect(screen.getByText('Base 1')).toHaveClass('text-sm', 'font-medium')
    expect(screen.getByText('10 文档').parentElement).toHaveClass('text-xs', 'text-foreground-muted')
    expect(container.querySelector('img')).toBeInTheDocument()
  })

  it('reserves trailing action space so long names cannot overlap the more button', () => {
    render(
      <KnowledgeBaseRow
        base={createKnowledgeBase({ name: 'A very long knowledge base name that should stay within the text column' })}
        groups={[createGroup()]}
        selected
        onSelectBase={vi.fn()}
        onMoveBase={vi.fn()}
        onRenameBase={vi.fn()}
        onDeleteBase={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /A very long knowledge base name/ }).parentElement).toHaveClass(
      'grid',
      'grid-cols-[minmax(0,1fr)_1.75rem]'
    )
    expect(screen.getByText('A very long knowledge base name that should stay within the text column')).toHaveClass(
      'truncate'
    )
  })
})
