import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type * as ReactModule from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import BaseNavigator from '../navigator'

vi.mock('@cherrystudio/ui', () => {
  const React = require('react') as typeof ReactModule

  const PopoverContext = React.createContext(false)
  const AccordionContext = React.createContext<{
    openValues: string[]
    toggleValue: (value: string) => void
  }>({
    openValues: [],
    toggleValue: () => undefined
  })
  const AccordionItemContext = React.createContext<string | null>(null)

  return {
    Accordion: ({ children, defaultValue }: { children: ReactNode; defaultValue?: string[] }) => {
      const [openValues, setOpenValues] = React.useState(defaultValue ?? [])

      return (
        <AccordionContext
          value={{
            openValues,
            toggleValue: (value: string) => {
              setOpenValues((currentValues) =>
                currentValues.includes(value)
                  ? currentValues.filter((currentValue) => currentValue !== value)
                  : [...currentValues, value]
              )
            }
          }}>
          <div>{children}</div>
        </AccordionContext>
      )
    },
    AccordionContent: ({ children }: { children: ReactNode }) => {
      const { openValues } = React.use(AccordionContext)
      const value = React.use(AccordionItemContext)

      return value && openValues.includes(value) ? <div>{children}</div> : null
    },
    AccordionItem: ({ children, value }: { children: ReactNode; value: string }) => (
      <AccordionItemContext value={value}>
        <div>{children}</div>
      </AccordionItemContext>
    ),
    AccordionTrigger: ({
      children,
      onClick,
      ...props
    }: {
      children: ReactNode
      onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void
      [key: string]: unknown
    }) => {
      const { openValues, toggleValue } = React.use(AccordionContext)
      const value = React.use(AccordionItemContext)
      const open = value ? openValues.includes(value) : false

      return (
        <button
          type="button"
          data-state={open ? 'open' : 'closed'}
          onClick={(event) => {
            onClick?.(event)
            if (value) {
              toggleValue(value)
            }
          }}
          {...props}>
          {children}
        </button>
      )
    },
    Button: ({
      children,
      type = 'button',
      ...props
    }: {
      children: ReactNode
      type?: 'button' | 'reset' | 'submit'
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
      <button type="button" data-active={active ? 'true' : 'false'} {...props}>
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
    Scrollbar: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    )
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
          'knowledge_v2.title': '知识库',
          'knowledge_v2.add.title': '新建知识库',
          'knowledge_v2.search': '搜索知识库',
          'knowledge_v2.empty': '暂无知识库',
          'knowledge_v2.groups.add': '新建分组',
          'knowledge_v2.groups.create_base_here': '在此分组新建',
          'knowledge_v2.groups.delete': '删除分组',
          'knowledge_v2.groups.delete_confirm_description': '删除后，该分组下的知识库将移至未分组。',
          'knowledge_v2.groups.delete_confirm_title': '确认删除分组',
          'knowledge_v2.groups.ungrouped': '未分组',
          'knowledge_v2.context.rename': '重命名',
          'knowledge_v2.context.move_to': '移动到',
          'knowledge_v2.context.delete': '删除知识库',
          'knowledge_v2.context.delete_confirm_title': '确认删除知识库',
          'knowledge_v2.context.delete_confirm_description': '删除后无法恢复',
          'knowledge_v2.status.completed': '就绪',
          'knowledge_v2.status.failed': '失败'
        }) as Record<string, string>
      )[key] ?? (typeof options?.count === 'number' ? `${options.count}` : key)
  })
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  id: '',
  name: '',
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

const createGroup = (overrides: Partial<Group> = {}): Group => ({
  id: 'group-1',
  entityType: 'knowledge',
  name: 'Research',
  orderKey: 'a0',
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
  ...overrides
})

const getBaseMoreButton = (baseName: string) => {
  const baseRow = screen.getByRole('button', { name: new RegExp(baseName) }).parentElement
  if (!baseRow) {
    throw new Error(`Missing base row for ${baseName}`)
  }

  return within(baseRow).getByRole('button', { name: '更多' })
}

const getGroupMoreButton = (groupName: string) => {
  const groupTrigger = screen.getByRole('button', { name: new RegExp(groupName) })
  const groupRow = groupTrigger.parentElement?.parentElement
  if (!groupRow) {
    throw new Error(`Missing group row for ${groupName}`)
  }

  return within(groupRow).getByRole('button', { name: '更多' })
}

describe('BaseNavigator', () => {
  it('keeps horizontal padding around the knowledge base list', () => {
    const { container } = render(
      <BaseNavigator
        bases={[createKnowledgeBase({ id: 'base-1', name: 'Alpha' })]}
        groups={[]}
        width={280}
        selectedBaseId="base-1"
        onSelectBase={vi.fn()}
        onCreateGroup={vi.fn()}
        onCreateBase={vi.fn()}
        onMoveBase={vi.fn()}
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    expect(container.querySelector('.min-h-0.flex-1')).toHaveClass('px-1.5')
  })

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
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    expect(screen.getByText('Research')).toBeInTheDocument()
    expect(screen.getByText('workspace')).toBeInTheDocument()
  })

  it('renders ungrouped bases before real group sections', () => {
    render(
      <BaseNavigator
        bases={[
          createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' }),
          createKnowledgeBase({ id: 'base-2', name: 'Beta', groupId: null })
        ]}
        groups={[createGroup({ id: 'group-1', name: 'Research' })]}
        width={280}
        selectedBaseId="base-2"
        onSelectBase={vi.fn()}
        onCreateGroup={vi.fn()}
        onCreateBase={vi.fn()}
        onMoveBase={vi.fn()}
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    const ungroupedBase = screen.getByRole('button', { name: /Beta/ })
    const firstRealGroup = screen.getByRole('button', { name: /Research/ })

    expect(ungroupedBase.compareDocumentPosition(firstRealGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders ungrouped bases without a synthetic group label', () => {
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
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /Alpha/ })).toBeInTheDocument()
    expect(screen.queryByText('未分组')).not.toBeInTheDocument()
  })

  it('shows ungrouped as a move target for grouped bases', async () => {
    const onMoveBase = vi.fn().mockResolvedValue(undefined)

    render(
      <BaseNavigator
        bases={[createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' })]}
        groups={[createGroup({ id: 'group-1', name: 'Research' })]}
        width={280}
        selectedBaseId="base-1"
        onSelectBase={vi.fn()}
        onCreateGroup={vi.fn()}
        onCreateBase={vi.fn()}
        onMoveBase={onMoveBase}
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: /Alpha/ }))

    expect(screen.getByText('移动到')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '未分组' })[0])

    await waitFor(() => {
      expect(onMoveBase).toHaveBeenCalledWith('base-1', null)
    })
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
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: /Alpha/ }))

    expect(screen.getByRole('button', { name: '重命名' })).not.toBeDisabled()
    expect(screen.getByText('移动到')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Research' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '未分组' })).toHaveLength(1)
    expect(
      screen
        .getAllByRole('button', { name: 'Archive' })
        .find((button) => button.getAttribute('data-active') === 'false')
    ).toBeDefined()

    fireEvent.click(
      screen
        .getAllByRole('button', { name: 'Archive' })
        .find((button) => button.getAttribute('data-active') === 'false') ??
        screen.getAllByRole('button', { name: 'Archive' })[0]
    )

    await waitFor(() => {
      expect(onMoveBase).toHaveBeenCalledWith('base-1', 'group-2')
    })
  })

  it('hides the move-to section when an ungrouped base has no group targets', () => {
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
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: /Alpha/ }))

    expect(screen.queryByText('移动到')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '未分组' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除知识库' })).toBeInTheDocument()
  })

  it('opens the knowledge base menu from the trailing action button', () => {
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
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    fireEvent.click(getBaseMoreButton('Alpha'))

    expect(screen.getByRole('button', { name: '重命名' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '删除知识库' })).toBeInTheDocument()
  })

  it('calls onRenameBase with the current knowledge base id and name', () => {
    const onRenameBase = vi.fn()

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
        onRenameBase={onRenameBase}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    fireEvent.click(getBaseMoreButton('Alpha'))
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))

    expect(onRenameBase).toHaveBeenCalledWith({
      id: 'base-1',
      name: 'Alpha'
    })
  })

  it('opens a delete confirmation dialog from the base menu and confirms deletion', async () => {
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
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
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

  it('opens a context menu on right click for a real group row', () => {
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
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: /Research/ }))

    expect(screen.getByRole('button', { name: '重命名' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '删除分组' })).toBeInTheDocument()
  })

  it('calls onRenameGroup with the current group id and name', () => {
    const onRenameGroup = vi.fn()

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
        onRenameBase={vi.fn()}
        onRenameGroup={onRenameGroup}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    fireEvent.click(getGroupMoreButton('Research'))
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))

    expect(onRenameGroup).toHaveBeenCalledWith({
      id: 'group-1',
      name: 'Research'
    })
  })

  it('opens the group menu from the trailing action button without toggling the accordion', () => {
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
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /Alpha/ })).toBeInTheDocument()

    fireEvent.click(getGroupMoreButton('Research'))

    expect(screen.getByRole('button', { name: /Alpha/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除分组' })).toBeInTheDocument()
  })

  it('opens a group delete confirmation dialog from the menu and confirms deletion', async () => {
    const onDeleteGroup = vi.fn().mockResolvedValue(undefined)

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
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={onDeleteGroup}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: /Research/ }))
    fireEvent.click(screen.getByRole('button', { name: '删除分组' }))

    expect(screen.getByText('确认删除分组')).toBeInTheDocument()
    expect(screen.getByText('删除后，该分组下的知识库将移至未分组。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(onDeleteGroup).toHaveBeenCalledWith('group-1')
    })
  })

  it('opens create knowledge base with the current group id from the group menu', () => {
    const onCreateBase = vi.fn()

    render(
      <BaseNavigator
        bases={[createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' })]}
        groups={[createGroup({ id: 'group-1', name: 'Research' })]}
        width={280}
        selectedBaseId="base-1"
        onSelectBase={vi.fn()}
        onCreateGroup={vi.fn()}
        onCreateBase={onCreateBase}
        onMoveBase={vi.fn()}
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: /Research/ }))
    fireEvent.click(screen.getByRole('button', { name: '在此分组新建' }))

    expect(onCreateBase).toHaveBeenCalledWith('group-1')
  })

  it('does not render a group menu trigger for the ungrouped section', () => {
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
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    expect(screen.queryByText('未分组')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '更多' })).toHaveLength(1)
  })

  it('filters visible sections and rows when the search value changes', () => {
    render(
      <BaseNavigator
        bases={[
          createKnowledgeBase({ id: 'base-1', name: 'Alpha Notes', groupId: 'group-1' }),
          createKnowledgeBase({ id: 'base-2', name: 'Beta Docs', groupId: 'group-2' })
        ]}
        groups={[
          createGroup({ id: 'group-1', name: 'Research' }),
          createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a1' })
        ]}
        width={280}
        selectedBaseId="base-1"
        onSelectBase={vi.fn()}
        onCreateGroup={vi.fn()}
        onCreateBase={vi.fn()}
        onMoveBase={vi.fn()}
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('搜索知识库...'), {
      target: { value: 'Alpha' }
    })

    expect(screen.getByText('Research')).toBeInTheDocument()
    expect(screen.queryByText('Archive')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Alpha Notes/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Beta Docs/ })).not.toBeInTheDocument()
  })

  it('highlights the selected base and forwards selection clicks', () => {
    const onSelectBase = vi.fn()

    render(
      <BaseNavigator
        bases={[
          createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' }),
          createKnowledgeBase({ id: 'base-2', name: 'Beta', groupId: 'group-1' })
        ]}
        groups={[createGroup({ id: 'group-1', name: 'Research' })]}
        width={280}
        selectedBaseId="base-1"
        onSelectBase={onSelectBase}
        onCreateGroup={vi.fn()}
        onCreateBase={vi.fn()}
        onMoveBase={vi.fn()}
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /Alpha/ })).toHaveClass('bg-accent')

    fireEvent.click(screen.getByRole('button', { name: /Beta/ }))

    expect(onSelectBase).toHaveBeenCalledWith('base-2')
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
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '新建分组' }))

    expect(onCreateGroup).toHaveBeenCalledTimes(1)
    expect(onCreateBase).not.toHaveBeenCalled()
    expect(screen.getByText('Research')).toBeInTheDocument()
  })

  it('uses both header and footer create-base buttons as knowledge base entry points', () => {
    const onCreateBase = vi.fn()

    render(
      <BaseNavigator
        bases={[]}
        groups={[]}
        width={280}
        selectedBaseId=""
        onSelectBase={vi.fn()}
        onCreateGroup={vi.fn()}
        onCreateBase={onCreateBase}
        onMoveBase={vi.fn()}
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    const createBaseButtons = screen.getAllByRole('button', { name: '新建知识库' })

    expect(createBaseButtons).toHaveLength(2)

    fireEvent.click(createBaseButtons[0])
    fireEvent.click(createBaseButtons[1])

    expect(onCreateBase).toHaveBeenCalledTimes(2)
  })

  it('renders a resize handle and binds mouse down to onResizeStart', () => {
    const onResizeStart = vi.fn()

    render(
      <BaseNavigator
        bases={[]}
        groups={[]}
        width={280}
        selectedBaseId=""
        onSelectBase={vi.fn()}
        onCreateGroup={vi.fn()}
        onCreateBase={vi.fn()}
        onMoveBase={vi.fn()}
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={onResizeStart}
      />
    )

    fireEvent.mouseDown(screen.getByTestId('base-navigator-resize-handle'))

    expect(onResizeStart).toHaveBeenCalledTimes(1)
  })
})
