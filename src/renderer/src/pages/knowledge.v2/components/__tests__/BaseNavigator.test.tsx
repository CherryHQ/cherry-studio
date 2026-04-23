import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as ReactModule from 'react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import BaseNavigator from '../BaseNavigator'

vi.mock('@cherrystudio/ui', () => {
  const React = require('react') as typeof ReactModule

  const PopoverContext = React.createContext(false)

  return {
    Accordion: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AccordionContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AccordionItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AccordionTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
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
    Input: (props: Record<string, unknown>) => <input {...props} />,
    MenuDivider: () => <hr />,
    MenuItem: ({
      active,
      icon,
      label,
      suffix,
      ...props
    }: {
      active?: boolean
      icon?: ReactNode
      label: string
      suffix?: ReactNode
      [key: string]: unknown
    }) => (
      <button data-active={active ? 'true' : 'false'} {...props}>
        {icon}
        {label}
        {suffix}
      </button>
    ),
    MenuList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Popover: ({ children, open }: { children: ReactNode; open?: boolean }) => (
      <PopoverContext value={Boolean(open)}>{children}</PopoverContext>
    ),
    PopoverAnchor: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    PopoverContent: ({ children }: { children: ReactNode }) => {
      const open = React.use(PopoverContext)
      return open ? <div>{children}</div> : null
    },
    Scrollbar: ({ children }: { children: ReactNode }) => <div>{children}</div>
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      (
        ({
          'common.cancel': '取消',
          'common.delete': '删除',
          'knowledge_v2.title': '知识库',
          'knowledge_v2.add.title': '新建知识库',
          'knowledge_v2.search': '搜索知识库',
          'knowledge_v2.empty': '暂无知识库',
          'knowledge_v2.groups.add': '新建分组',
          'knowledge_v2.groups.ungrouped': '未分组',
          'knowledge_v2.context.rename': '重命名',
          'knowledge_v2.context.move_to': '移动到',
          'knowledge_v2.context.delete': '删除知识库',
          'knowledge_v2.context.delete_confirm_title': '确认删除知识库',
          'knowledge_v2.context.delete_confirm_description': '删除后无法恢复'
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

const createGroup = (overrides: Partial<Group> = {}): Group => ({
  id: 'group-1',
  entityType: 'knowledge',
  name: 'Research',
  orderKey: 'a0',
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
  ...overrides
})

describe('BaseNavigator', () => {
  it('shows real group names and falls back to raw groupId when the mapping is missing', () => {
    render(
      <BaseNavigator
        bases={[
          createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' }),
          createKnowledgeBase({ id: 'base-2', name: 'Beta', groupId: 'workspace' })
        ]}
        groups={[createGroup({ id: 'group-1', name: 'Research' })]}
        width={280}
        selectedBaseId="base-1"
        onSelectBase={vi.fn()}
        onCreateGroup={vi.fn()}
        onCreateBase={vi.fn()}
        onMoveBase={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    expect(screen.getByText('Research')).toBeInTheDocument()
    expect(screen.getByText('workspace')).toBeInTheDocument()
  })

  it('falls back to the ungrouped label when groupId is missing', () => {
    render(
      <BaseNavigator
        bases={[createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: null })]}
        groups={[]}
        width={280}
        selectedBaseId="base-1"
        onSelectBase={vi.fn()}
        onCreateGroup={vi.fn()}
        onCreateBase={vi.fn()}
        onMoveBase={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    expect(screen.getByText('未分组')).toBeInTheDocument()
  })

  it('opens a context menu on right click and moves the base to another group', async () => {
    const onMoveBase = vi.fn().mockResolvedValue(undefined)

    render(
      <BaseNavigator
        bases={[createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' })]}
        groups={[
          createGroup({ id: 'group-1', name: 'Research' }),
          createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a1' })
        ]}
        width={280}
        selectedBaseId="base-1"
        onSelectBase={vi.fn()}
        onCreateGroup={vi.fn()}
        onCreateBase={vi.fn()}
        onMoveBase={onMoveBase}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: /Alpha/ }))

    expect(screen.getByRole('button', { name: '重命名' })).toBeDisabled()
    expect(screen.getByText('移动到')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Research' })).toHaveAttribute('data-active', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => {
      expect(onMoveBase).toHaveBeenCalledWith('base-1', 'group-2')
    })
  })

  it('opens a delete confirmation dialog from the context menu and confirms deletion', async () => {
    const onDeleteBase = vi.fn().mockResolvedValue(undefined)

    render(
      <BaseNavigator
        bases={[createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' })]}
        groups={[createGroup({ id: 'group-1', name: 'Research' })]}
        width={280}
        selectedBaseId="base-1"
        onSelectBase={vi.fn()}
        onCreateGroup={vi.fn()}
        onCreateBase={vi.fn()}
        onMoveBase={vi.fn()}
        onDeleteBase={onDeleteBase}
        onResizeStart={vi.fn()}
      />
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: /Alpha/ }))
    fireEvent.click(screen.getByRole('button', { name: '删除知识库' }))

    expect(screen.getByText('确认删除知识库')).toBeInTheDocument()
    expect(screen.getByText('删除后无法恢复')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(onDeleteBase).toHaveBeenCalledWith('base-1')
    })
  })

  it('uses the folder-plus button as the create-group entry', () => {
    const onCreateGroup = vi.fn()
    const onCreateBase = vi.fn()

    render(
      <BaseNavigator
        bases={[]}
        groups={[createGroup({ id: 'group-1', name: 'Research' })]}
        width={280}
        selectedBaseId=""
        onSelectBase={vi.fn()}
        onCreateGroup={onCreateGroup}
        onCreateBase={onCreateBase}
        onMoveBase={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '新建分组' }))

    expect(onCreateGroup).toHaveBeenCalledTimes(1)
    expect(onCreateBase).not.toHaveBeenCalled()
    expect(screen.getByText('Research')).toBeInTheDocument()
  })
})
