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
    t: (key: string) =>
      (
        ({
          'common.more': '更多',
          'knowledge.context.delete': '删除知识库',
          'knowledge.context.move_to': '移动到',
          'knowledge.context.rename': '重命名'
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
  it('renders only the base name, without the document count or status dot', () => {
    const { container } = render(
      <KnowledgeBaseRow
        base={createKnowledgeBase({ itemCount: 3 })}
        groups={[createGroup()]}
        selected={false}
        onSelectBase={vi.fn()}
        onMoveBase={vi.fn()}
        onRenameBase={vi.fn()}
        onDeleteBase={vi.fn()}
      />
    )

    expect(screen.getByText('Base 1')).toBeInTheDocument()
    expect(screen.queryByText('3 文档')).not.toBeInTheDocument()
    expect(container.querySelector('span[aria-label]')).not.toBeInTheDocument()
  })

  it('renders the selected row with the rounded highlight', () => {
    render(
      <KnowledgeBaseRow
        base={createKnowledgeBase()}
        groups={[createGroup()]}
        selected
        onSelectBase={vi.fn()}
        onMoveBase={vi.fn()}
        onRenameBase={vi.fn()}
        onDeleteBase={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /Base 1/ }).parentElement).toHaveClass('rounded-md', 'bg-secondary')
    expect(screen.getByText('Base 1')).toHaveClass('text-sm', 'font-medium')
  })

  it('does not render a hover more button; actions are only reachable via right-click', () => {
    render(
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

    expect(screen.queryByRole('button', { name: '更多' })).not.toBeInTheDocument()
  })

  it('lets long names use the full row width now that no trailing button is reserved', () => {
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

    expect(screen.getByRole('button', { name: /A very long knowledge base name/ }).parentElement).not.toHaveClass(
      'grid-cols-[minmax(0,1fr)_1.75rem]'
    )
    expect(screen.getByText('A very long knowledge base name that should stay within the text column')).toHaveClass(
      'truncate'
    )
  })
})
