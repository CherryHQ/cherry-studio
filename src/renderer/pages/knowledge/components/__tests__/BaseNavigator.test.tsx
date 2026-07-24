import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'
import type { Group } from '@shared/data/types/group'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type * as ReactModule from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseNavigator } from '../navigator'

const dndMocks = vi.hoisted(() => ({
  activatorNodes: new Map<string, HTMLElement>(),
  draggableData: new Map<string, unknown>(),
  draggableNodes: new Map<string, HTMLElement>(),
  droppableData: new Map<string, unknown>(),
  droppableNodes: new Map<string, HTMLElement>(),
  listeners: new Map<
    string,
    {
      onKeyDown: ReturnType<typeof vi.fn>
      onPointerDown: ReturnType<typeof vi.fn>
    }
  >(),
  accessibility: undefined as any,
  onDragCancel: undefined as undefined | ((event: any) => void),
  onDragEnd: undefined as undefined | ((event: any) => void),
  onDragStart: undefined as undefined | ((event: any) => void),
  sensors: undefined as any,
  useSensor: vi.fn((sensor, options) => ({ options, sensor }))
}))

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core')
  const React = require('react') as typeof ReactModule

  return {
    ...actual,
    DndContext: ({
      accessibility,
      children,
      onDragCancel,
      onDragEnd,
      onDragStart,
      sensors
    }: {
      accessibility?: any
      children: ReactNode
      onDragCancel?: (event: any) => void
      onDragEnd?: (event: any) => void
      onDragStart?: (event: any) => void
      sensors?: any
    }) => {
      dndMocks.accessibility = accessibility
      dndMocks.onDragCancel = onDragCancel
      dndMocks.onDragEnd = onDragEnd
      dndMocks.onDragStart = onDragStart
      dndMocks.sensors = sensors
      return React.createElement('div', { 'data-testid': 'knowledge-dnd-context' }, children)
    },
    DragOverlay: ({ children }: { children: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'knowledge-drag-overlay' }, children),
    useDraggable: ({
      attributes,
      data,
      id
    }: {
      attributes?: { roleDescription?: string }
      data: unknown
      id: string
    }) => {
      dndMocks.draggableData.set(id, data)
      const listeners = {
        onKeyDown: vi.fn(),
        onPointerDown: vi.fn()
      }
      dndMocks.listeners.set(id, listeners)

      return {
        attributes: {
          role: 'button',
          tabIndex: 0,
          'aria-roledescription': attributes?.roleDescription ?? 'draggable'
        },
        isDragging: false,
        listeners,
        setActivatorNodeRef: (node: HTMLElement | null) => {
          if (node) {
            dndMocks.activatorNodes.set(id, node)
          } else {
            dndMocks.activatorNodes.delete(id)
          }
        },
        setNodeRef: (node: HTMLElement | null) => {
          if (node) {
            dndMocks.draggableNodes.set(id, node)
          } else {
            dndMocks.draggableNodes.delete(id)
          }
        },
        transform: null
      }
    },
    useDroppable: ({ data, id }: { data: unknown; id: string }) => {
      dndMocks.droppableData.set(id, data)
      return {
        isOver: false,
        setNodeRef: (node: HTMLElement | null) => {
          if (node) {
            dndMocks.droppableNodes.set(id, node)
          } else {
            dndMocks.droppableNodes.delete(id)
          }
        }
      }
    },
    useSensor: dndMocks.useSensor,
    useSensors: vi.fn((...sensors) => sensors)
  }
})

vi.mock('@dnd-kit/utilities', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/utilities')>('@dnd-kit/utilities')

  return {
    ...actual,
    CSS: {
      ...actual.CSS,
      Translate: {
        toString: vi.fn(() => undefined)
      }
    }
  }
})

vi.mock('@cherrystudio/ui', () => {
  const React = require('react') as typeof ReactModule

  const PopoverContext = React.createContext<{ open: boolean; onOpenChange?: (open: boolean) => void }>({ open: false })
  const DropdownMenuContext = React.createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
    open: false,
    setOpen: () => undefined
  })
  const ContextMenuContext = React.createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
    open: false,
    setOpen: () => undefined
  })
  const AccordionContext = React.createContext<{
    openValues: string[]
    toggleValue: (value: string) => void
  }>({
    openValues: [],
    toggleValue: () => undefined
  })
  const AccordionItemContext = React.createContext<string | null>(null)

  return {
    Accordion: ({
      children,
      defaultValue,
      value,
      onValueChange
    }: {
      children: ReactNode
      defaultValue?: string[]
      value?: string[]
      onValueChange?: (value: string[]) => void
    }) => {
      // Mirror Radix's controllable state: `value` wins when provided, else the
      // internal state seeded from `defaultValue`.
      const [internalValues, setInternalValues] = React.useState(defaultValue ?? [])
      const openValues = value ?? internalValues

      return (
        <AccordionContext
          value={{
            openValues,
            toggleValue: (toggled: string) => {
              const nextValues = openValues.includes(toggled)
                ? openValues.filter((currentValue) => currentValue !== toggled)
                : [...openValues, toggled]
              if (value === undefined) {
                setInternalValues(nextValues)
              }
              onValueChange?.(nextValues)
            }
          }}>
          <div>{children}</div>
        </AccordionContext>
      )
    },
    AccordionContent: ({
      children,
      className,
      contentClassName
    }: {
      children: ReactNode
      className?: string
      contentClassName?: string
    }) => {
      const { openValues } = React.use(AccordionContext)
      const value = React.use(AccordionItemContext)

      return value && openValues.includes(value) ? (
        <div data-slot="accordion-content" data-state="open" className={contentClassName}>
          <div className={className}>{children}</div>
        </div>
      ) : null
    },
    AccordionItem: ({
      children,
      ref,
      value,
      ...props
    }: {
      children: ReactNode
      ref?: ReactModule.Ref<HTMLDivElement>
      value: string
      [key: string]: unknown
    }) => (
      <AccordionItemContext value={value}>
        <div ref={ref} data-accordion-item={value} {...props}>
          {children}
        </div>
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
    EmptyState: ({ title, description }: { title?: ReactNode; description?: ReactNode }) => (
      <div>
        {title}
        {description}
      </div>
    ),
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
    Popover: ({
      children,
      open,
      onOpenChange
    }: {
      children: ReactNode
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) => <PopoverContext value={{ open: Boolean(open), onOpenChange }}>{children}</PopoverContext>,
    PopoverAnchor: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    PopoverContent: ({ children, align }: { children: ReactNode; align?: string }) => {
      const { open } = React.use(PopoverContext)
      return open ? <div data-popover-align={align}>{children}</div> : null
    },
    PopoverTrigger: ({ children, asChild }: { children: ReactNode; asChild?: boolean }) => {
      const { open, onOpenChange } = React.use(PopoverContext)

      if (asChild && React.isValidElement(children)) {
        const child = children as React.ReactElement<{
          onClick?: (event: ReactMouseEvent) => void
        }>

        // eslint-disable-next-line @eslint-react/no-clone-element -- mock reproduces Radix asChild slot behavior
        return React.cloneElement(child, {
          onClick: (event: ReactMouseEvent) => {
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
    },
    DropdownMenu: ({
      children,
      open: controlledOpen,
      onOpenChange
    }: {
      children?: ReactNode
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) => {
      const [uncontrolled, setUncontrolled] = React.useState(false)
      const open = controlledOpen ?? uncontrolled
      const setOpen = (next: boolean) => {
        setUncontrolled(next)
        onOpenChange?.(next)
      }
      return React.createElement(DropdownMenuContext, { value: { open, setOpen } }, children)
    },
    DropdownMenuTrigger: ({
      asChild,
      children,
      ...props
    }: {
      asChild?: boolean
      children?: ReactNode
      [key: string]: unknown
    }) => {
      const ctx = React.use(DropdownMenuContext)
      const triggerProps = {
        ...props,
        onClick: (event: ReactMouseEvent<HTMLElement>) => {
          ;(props.onClick as ((e: ReactMouseEvent<HTMLElement>) => void) | undefined)?.(event)
          ctx.setOpen(true)
        }
      }
      if (asChild && React.isValidElement(children)) {
        // eslint-disable-next-line @eslint-react/no-clone-element -- mock reproduces Radix asChild slot behavior
        return React.cloneElement(children, triggerProps)
      }
      return (
        <button type="button" {...triggerProps}>
          {children}
        </button>
      )
    },
    DropdownMenuContent: ({ children }: { children?: ReactNode }) => {
      const ctx = React.use(DropdownMenuContext)
      return ctx.open ? <div>{children}</div> : null
    },
    DropdownMenuItem: ({
      children,
      onSelect,
      variant,
      ...props
    }: {
      children?: ReactNode
      onSelect?: () => void
      variant?: string
      [key: string]: unknown
    }) => (
      <button type="button" data-active="false" data-variant={variant} onClick={() => onSelect?.()} {...props}>
        {children}
      </button>
    ),
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuLabel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DropdownMenuSub: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DropdownMenuSubContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DropdownMenuSubTrigger: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    ContextMenu: ({ children, onOpenChange }: { children?: ReactNode; onOpenChange?: (open: boolean) => void }) => {
      const [open, setOpenState] = React.useState(false)
      const setOpen = (next: boolean) => {
        setOpenState(next)
        onOpenChange?.(next)
      }
      return React.createElement(ContextMenuContext, { value: { open, setOpen } }, children)
    },
    ContextMenuTrigger: ({
      asChild,
      children,
      ...props
    }: {
      asChild?: boolean
      children?: ReactNode
      [key: string]: unknown
    }) => {
      const ctx = React.use(ContextMenuContext)
      const handleContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
        ;(props.onContextMenu as ((e: ReactMouseEvent<HTMLElement>) => void) | undefined)?.(event)
        event.preventDefault()
        ctx.setOpen(true)
      }
      if (asChild && React.isValidElement(children)) {
        const childProps = (children.props ?? {}) as Record<string, unknown>
        const merged: Record<string, unknown> = {
          ...props,
          ...childProps,
          onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
            ;(childProps.onContextMenu as ((e: ReactMouseEvent<HTMLElement>) => void) | undefined)?.(event)
            if (!event.defaultPrevented) {
              handleContextMenu(event)
            }
          }
        }
        // eslint-disable-next-line @eslint-react/no-clone-element -- mock reproduces Radix asChild slot behavior
        return React.cloneElement(children, merged)
      }
      return (
        <div onContextMenu={handleContextMenu} {...props}>
          {children}
        </div>
      )
    },
    ContextMenuContent: ({ children }: { children?: ReactNode }) => {
      const ctx = React.use(ContextMenuContext)
      return ctx.open ? <div>{children}</div> : null
    },
    ContextMenuItem: ({
      children,
      onSelect,
      variant,
      ...props
    }: {
      children?: ReactNode
      onSelect?: () => void
      variant?: string
      [key: string]: unknown
    }) => (
      <button type="button" data-active="false" data-variant={variant} onClick={() => onSelect?.()} {...props}>
        {children}
      </button>
    ),
    ContextMenuCheckboxItem: ({
      children,
      onCheckedChange,
      ...props
    }: {
      children?: ReactNode
      onCheckedChange?: (next: boolean) => void
      [key: string]: unknown
    }) => (
      <button type="button" onClick={() => onCheckedChange?.(true)} {...props}>
        {children}
      </button>
    ),
    ContextMenuItemContent: ({
      children,
      icon,
      shortcut
    }: {
      children?: ReactNode
      icon?: ReactNode
      shortcut?: string
    }) => (
      <span>
        {icon}
        <span>{children}</span>
        {shortcut ? <span>{shortcut}</span> : null}
      </span>
    ),
    ContextMenuSeparator: () => <hr />,
    ContextMenuSub: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    ContextMenuSubContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    ContextMenuSubTrigger: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Scrollbar: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    SearchInput: ({
      clearLabel,
      onClear,
      value,
      ...props
    }: {
      clearLabel?: string
      onClear?: () => void
      value?: string
      [key: string]: unknown
    }) => (
      <div>
        <input value={value} {...props} />
        {value && onClear ? (
          <button type="button" aria-label={clearLabel} onClick={onClear}>
            {clearLabel}
          </button>
        ) : null}
      </div>
    )
  }
})

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [undefined, () => undefined],
  useMultiplePreferences: () => [{}, () => undefined]
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'zh-CN'
    },
    t: (key: string, options?: { count?: number; group?: string; groups?: string; name?: string }) =>
      (
        ({
          'common.add': '添加',
          'common.cancel': '取消',
          'common.delete': '删除',
          'common.clear': '清除',
          'common.more': '更多',
          'knowledge.title': '知识库',
          'knowledge.add.title': '新建知识库',
          'knowledge.search': '搜索知识库',
          'knowledge.empty': '暂无知识库',
          'knowledge.groups.add': '新建分组',
          'knowledge.groups.create_base_here': '在此分组新建',
          'knowledge.groups.default': '默认',
          'knowledge.groups.delete': '删除分组',
          'knowledge.groups.delete_confirm_description': '删除后，该分组下的知识库将移至默认分组。',
          'knowledge.groups.delete_confirm_title': '确认删除分组',
          'knowledge.context.rename': '重命名',
          'knowledge.context.move_to': '移动到',
          'knowledge.context.delete': '删除知识库',
          'knowledge.context.delete_confirm_title': '确认删除知识库',
          'knowledge.context.delete_confirm_description': '删除后无法恢复',
          'knowledge.drag.cancelled': `已取消移动 ${options?.name ?? ''}。`,
          'knowledge.drag.drop_requested': `已在 ${options?.group ?? ''} 放下 ${options?.name ?? ''}，正在请求移动。`,
          'knowledge.drag.dropped': `已将 ${options?.name ?? ''} 移至 ${options?.group ?? ''}。`,
          'knowledge.drag.instructions': `按空格或回车拿起知识库，使用方向键选择分组，再按空格或回车移动，按 Esc 取消。可用分组：${options?.groups ?? ''}。`,
          'knowledge.drag.over': `${options?.name ?? ''} 位于 ${options?.group ?? ''} 分组上方。`,
          'knowledge.drag.picked_up': `已拿起 ${options?.name ?? ''}，请选择目标分组。`,
          'knowledge.drag.unchanged': `${options?.name ?? ''} 仍在 ${options?.group ?? ''}，未移动。`,
          'knowledge.status.completed': '就绪',
          'knowledge.status.failed': '失败'
        }) as Record<string, string>
      )[key] ?? (typeof options?.count === 'number' ? `${options.count}` : key)
  })
}))

const createKnowledgeBase = (overrides: Partial<KnowledgeBaseListItem> = {}): KnowledgeBaseListItem => ({
  id: '',
  name: '',
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
  documentCount: undefined,
  status: 'completed',
  error: null,
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

const getGroupMoreButton = (groupName: string) => {
  const groupTrigger = screen.getByRole('button', { name: new RegExp(groupName) })
  const groupRow = groupTrigger.parentElement?.parentElement
  if (!groupRow) {
    throw new Error(`Missing group row for ${groupName}`)
  }

  return within(groupRow).getByRole('button', { name: '更多' })
}

const getMenuButton = (name: string) => {
  const button = screen
    .getAllByRole('button', { name })
    .find((element) => element.getAttribute('data-active') === 'false')

  if (!button) {
    throw new Error(`Missing menu button for ${name}`)
  }

  return button
}

const renderDragNavigator = ({
  bases,
  groups,
  onMoveBase = vi.fn(),
  onSelectBase = vi.fn()
}: {
  bases: KnowledgeBaseListItem[]
  groups: Group[]
  onMoveBase?: ReturnType<typeof vi.fn>
  onSelectBase?: ReturnType<typeof vi.fn>
}) => {
  render(
    <BaseNavigator
      bases={bases}
      groups={groups}
      width={280}
      selectedBaseId={bases[0]?.id ?? ''}
      onSelectBase={onSelectBase}
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

  return { onMoveBase, onSelectBase }
}

const getDragEntry = (baseId: string) => {
  const entry = Array.from(dndMocks.draggableData.entries()).find(
    ([, data]) =>
      typeof data === 'object' &&
      data !== null &&
      (data as { type?: string }).type === 'knowledge-base' &&
      (data as { baseId?: string }).baseId === baseId
  )

  if (!entry) {
    throw new Error(`Missing drag data for ${baseId}`)
  }

  return { data: { current: entry[1] }, id: entry[0] }
}

const getDropEntry = (groupId: string | null) => {
  const entry = Array.from(dndMocks.droppableData.entries()).find(
    ([, data]) =>
      typeof data === 'object' &&
      data !== null &&
      (data as { type?: string }).type === 'knowledge-group' &&
      (data as { groupId?: string | null }).groupId === groupId
  )

  if (!entry) {
    throw new Error(`Missing drop data for ${groupId ?? 'ungrouped'}`)
  }

  return { data: { current: entry[1] }, id: entry[0] }
}

const dropBaseIntoGroup = (baseId: string, groupId: string | null) => {
  if (!dndMocks.onDragEnd) {
    throw new Error('Missing knowledge navigator drag-end handler')
  }

  dndMocks.onDragEnd({
    active: getDragEntry(baseId),
    over: getDropEntry(groupId)
  })
}

describe('BaseNavigator', () => {
  beforeEach(() => {
    dndMocks.activatorNodes.clear()
    dndMocks.draggableData.clear()
    dndMocks.draggableNodes.clear()
    dndMocks.droppableData.clear()
    dndMocks.droppableNodes.clear()
    dndMocks.listeners.clear()
    dndMocks.accessibility = undefined
    dndMocks.onDragCancel = undefined
    dndMocks.onDragEnd = undefined
    dndMocks.onDragStart = undefined
    dndMocks.sensors = undefined
    dndMocks.useSensor.mockClear()
  })

  it('keeps stable horizontal layout around the knowledge base list', () => {
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

    expect(container.querySelector('.min-h-0.flex-1')).toHaveClass('overflow-x-hidden', 'px-2.5', 'pb-3')
    expect(container.querySelector('.min-h-0.flex-1')?.className).not.toContain('px-0')
    expect(container.querySelector('.min-h-0.flex-1')?.className).not.toContain('[scrollbar-gutter:auto]')
    expect(container.querySelector('.min-h-0.flex-1')?.className).not.toContain('[scrollbar-gutter:stable_both-edges]')
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

  it('does not render item counts next to the group labels', () => {
    render(
      <BaseNavigator
        bases={[
          createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: null }),
          createKnowledgeBase({ id: 'base-2', name: 'Beta', groupId: 'group-1' })
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

    expect(within(screen.getByRole('button', { name: /默认/ })).queryByText('1')).not.toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /Research/ })).queryByText('1')).not.toBeInTheDocument()
  })

  it('keeps the group expand and collapse motion classes attached', () => {
    const { container } = render(
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

    const groupTrigger = screen.getByRole('button', { name: /Research/ })
    const accordionContent = container.querySelector('[data-slot="accordion-content"]')
    const accordionContentInner = accordionContent?.firstElementChild

    expect(groupTrigger).toHaveClass(
      'motion-safe:[&>svg]:duration-[150ms]',
      'motion-safe:[&>svg]:ease-[cubic-bezier(0.25,1,0.5,1)]'
    )
    expect(accordionContent).toHaveClass(
      'motion-safe:data-[state=open]:[animation-duration:180ms]',
      'motion-safe:data-[state=closed]:[animation-duration:120ms]',
      'motion-safe:data-[state=open]:[&>div]:animate-in',
      'motion-safe:data-[state=open]:[&>div]:delay-[16ms]'
    )
    expect(accordionContentInner).toHaveClass('pt-1.5', 'pb-0')
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

  it('renders ungrouped bases flat without the default group header when no group exists', () => {
    render(
      <BaseNavigator
        bases={[
          createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: null }),
          createKnowledgeBase({ id: 'base-2', name: 'Beta', groupId: null })
        ]}
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
    expect(screen.getByRole('button', { name: /Beta/ })).toBeInTheDocument()
    expect(screen.queryByText('默认')).not.toBeInTheDocument()
  })

  it('expands a group section that appears after mount', () => {
    const sharedProps = {
      width: 280,
      selectedBaseId: 'base-1',
      onSelectBase: vi.fn(),
      onCreateGroup: vi.fn(),
      onCreateBase: vi.fn(),
      onMoveBase: vi.fn(),
      onRenameBase: vi.fn(),
      onRenameGroup: vi.fn(),
      onDeleteGroup: vi.fn(),
      onDeleteBase: vi.fn(),
      onResizeStart: vi.fn()
    }
    const { rerender } = render(
      <BaseNavigator
        bases={[createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' })]}
        groups={[createGroup({ id: 'group-1', name: 'Research' })]}
        {...sharedProps}
      />
    )

    // A group created (and adopted into) after mount must start expanded — with a
    // mount-time defaultValue the freshly moved base would render collapsed/invisible.
    rerender(
      <BaseNavigator
        bases={[
          createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' }),
          createKnowledgeBase({ id: 'base-2', name: 'Beta', groupId: 'group-2' })
        ]}
        groups={[
          createGroup({ id: 'group-1', name: 'Research' }),
          createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a1' })
        ]}
        {...sharedProps}
      />
    )

    expect(screen.getByRole('button', { name: /Beta/ })).toBeInTheDocument()
  })

  it('keeps the accordion when a base points at a deleted group', () => {
    render(
      <BaseNavigator
        bases={[
          createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: null }),
          createKnowledgeBase({ id: 'base-2', name: 'Beta', groupId: 'ghost-group' })
        ]}
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

    // The unknown-group section still needs a header to make sense of, so the
    // flat layout does not apply.
    expect(screen.getByText('默认')).toBeInTheDocument()
    expect(screen.getByText('ghost-group')).toBeInTheDocument()
  })

  it('shows the default knowledge group as a move target for grouped bases', async () => {
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

    fireEvent.contextMenu(screen.getByRole('button', { name: /Alpha/ }), { clientX: 240, clientY: 320 })

    expect(screen.getByText('移动到')).toBeInTheDocument()
    fireEvent.click(getMenuButton('默认'))

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

    fireEvent.contextMenu(screen.getByRole('button', { name: /Alpha/ }), { clientX: 240, clientY: 320 })

    expect(screen.getByRole('button', { name: '重命名' })).not.toBeDisabled()
    expect(screen.getByText('移动到')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Research/ })).toHaveLength(1)
    expect(getMenuButton('默认')).toBeInTheDocument()
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

  it('moves a knowledge base to another populated group by drag and drop', () => {
    const { onMoveBase } = renderDragNavigator({
      bases: [
        createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' }),
        createKnowledgeBase({ id: 'base-2', name: 'Beta', groupId: 'group-2' })
      ],
      groups: [
        createGroup({ id: 'group-1', name: 'Research' }),
        createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a1' })
      ]
    })

    dropBaseIntoGroup('base-1', 'group-2')

    expect(onMoveBase).toHaveBeenCalledWith('base-1', 'group-2')
  })

  it('moves a grouped knowledge base to the ungrouped section by drag and drop', () => {
    const { onMoveBase } = renderDragNavigator({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' })],
      groups: [createGroup({ id: 'group-1', name: 'Research' })]
    })

    dropBaseIntoGroup('base-1', null)

    expect(onMoveBase).toHaveBeenCalledWith('base-1', null)
  })

  it('moves a knowledge base into an empty group by drag and drop', () => {
    const { onMoveBase } = renderDragNavigator({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' })],
      groups: [
        createGroup({ id: 'group-1', name: 'Research' }),
        createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a1' })
      ]
    })

    expect(screen.getByText('Archive')).toBeInTheDocument()
    dropBaseIntoGroup('base-1', 'group-2')

    expect(onMoveBase).toHaveBeenCalledWith('base-1', 'group-2')
  })

  it('does not move a knowledge base when dropped into its current group', () => {
    const { onMoveBase } = renderDragNavigator({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' })],
      groups: [createGroup({ id: 'group-1', name: 'Research' })]
    })

    dropBaseIntoGroup('base-1', 'group-1')

    expect(onMoveBase).not.toHaveBeenCalled()
  })

  it('does not select a knowledge base when the drag-end path moves it to another group', () => {
    const { onMoveBase, onSelectBase } = renderDragNavigator({
      bases: [
        createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' }),
        createKnowledgeBase({ id: 'base-2', name: 'Beta', groupId: 'group-2' })
      ],
      groups: [
        createGroup({ id: 'group-1', name: 'Research' }),
        createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a1' })
      ]
    })

    dropBaseIntoGroup('base-1', 'group-2')

    expect(onMoveBase).toHaveBeenCalledWith('base-1', 'group-2')
    expect(onSelectBase).not.toHaveBeenCalled()
  })

  it('uses a distance-activated pointer sensor that accepts left drag and rejects modifier-click and right-click', () => {
    renderDragNavigator({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' })],
      groups: [createGroup({ id: 'group-1', name: 'Research' })]
    })

    const [pointerSensor, options] = dndMocks.useSensor.mock.calls[0]
    const activator = (pointerSensor as typeof import('@dnd-kit/core').PointerSensor).activators[0]
    const activateLeftDrag = vi.fn()
    const activateCtrlClick = vi.fn()
    const activateMetaClick = vi.fn()
    const activateRightClick = vi.fn()

    expect(options).toEqual({ activationConstraint: { distance: 6 } })
    expect(
      activator.handler(
        { nativeEvent: { button: 0, ctrlKey: false, isPrimary: true, metaKey: false } } as never,
        { onActivation: activateLeftDrag } as never
      )
    ).toBe(true)
    expect(activateLeftDrag).toHaveBeenCalledTimes(1)
    expect(
      activator.handler(
        { nativeEvent: { button: 0, ctrlKey: true, isPrimary: true, metaKey: false } } as never,
        { onActivation: activateCtrlClick } as never
      )
    ).toBe(false)
    expect(activateCtrlClick).not.toHaveBeenCalled()
    expect(
      activator.handler(
        { nativeEvent: { button: 0, ctrlKey: false, isPrimary: true, metaKey: true } } as never,
        { onActivation: activateMetaClick } as never
      )
    ).toBe(false)
    expect(activateMetaClick).not.toHaveBeenCalled()
    expect(
      activator.handler(
        { nativeEvent: { button: 2, ctrlKey: false, isPrimary: true, metaKey: false } } as never,
        { onActivation: activateRightClick } as never
      )
    ).toBe(false)
    expect(activateRightClick).not.toHaveBeenCalled()
  })

  it('suppresses the click generated after a real pointer sensor drag activates', () => {
    vi.useFakeTimers()

    try {
      const { onSelectBase } = renderDragNavigator({
        bases: [createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' })],
        groups: [createGroup({ id: 'group-1', name: 'Research' })]
      })

      const [pointerSensor, options] = dndMocks.useSensor.mock.calls[0]
      const alpha = screen.getByRole('button', { name: /Alpha/ })
      const pointerDown = new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 })
      Object.defineProperty(pointerDown, 'target', { value: alpha })
      const onStart = vi.fn()

      new pointerSensor({
        active: 'knowledge-base:base-1',
        activeNode: {},
        context: { current: {} },
        event: pointerDown,
        onAbort: vi.fn(),
        onCancel: vi.fn(),
        onEnd: vi.fn(),
        onMove: vi.fn(),
        onPending: vi.fn(),
        onStart,
        options
      } as never)

      document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 20, clientY: 10 }))
      document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 20, clientY: 10 }))
      alpha.click()

      expect(onStart).toHaveBeenCalledTimes(1)
      expect(onSelectBase).not.toHaveBeenCalled()
      vi.runOnlyPendingTimers()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders the active knowledge base in an unclipped semantic drag overlay', () => {
    renderDragNavigator({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' })],
      groups: [createGroup({ id: 'group-1', name: 'Research' })]
    })

    act(() => {
      dndMocks.onDragStart?.({
        active: {
          ...getDragEntry('base-1'),
          rect: { current: { initial: { height: 32, width: 220 }, translated: null } }
        }
      })
    })

    const overlay = screen.getByTestId('knowledge-drag-overlay')
    expect(overlay.parentElement).toBe(document.body)
    expect(screen.getByTestId('knowledge-dnd-context')).not.toContainElement(overlay)
    expect(within(overlay).getByText('Alpha')).toHaveClass('truncate')
    expect(overlay.firstElementChild).toHaveClass('border-border', 'bg-popover', 'shadow-md')
    expect(overlay.firstElementChild).toHaveStyle({ width: '220px' })
    expect(screen.getByRole('button', { name: /Alpha/ }).parentElement?.style.transform).toBe('')

    act(() => dndMocks.onDragCancel?.({}))
    expect(within(overlay).queryByText('Alpha')).not.toBeInTheDocument()
  })

  it('wires the row DOM activator and executes keyboard coordinates toward a group', () => {
    renderDragNavigator({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' })],
      groups: [
        createGroup({ id: 'group-1', name: 'Research' }),
        createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a1' })
      ]
    })

    const [, keyboardOptions] = dndMocks.useSensor.mock.calls[1]
    const active = getDragEntry('base-1')
    const archive = getDropEntry('group-2')
    const activeNode = dndMocks.droppableNodes.get(active.id)
    const archiveNode = dndMocks.droppableNodes.get(archive.id)
    const announcements = dndMocks.accessibility.announcements
    const alphaButton = screen.getByRole('button', { name: /Alpha/ })
    const listeners = dndMocks.listeners.get(active.id)

    expect(keyboardOptions).toEqual({ coordinateGetter: sortableKeyboardCoordinates })
    expect(alphaButton).toHaveAttribute('aria-roledescription', 'draggable')
    expect(dndMocks.activatorNodes.get(active.id)).toBe(alphaButton)
    expect(dndMocks.draggableNodes.get(active.id)).toBe(alphaButton.parentElement)
    expect(activeNode).toBe(alphaButton.parentElement)
    expect(listeners).toBeDefined()

    fireEvent.pointerDown(alphaButton)
    fireEvent.keyDown(alphaButton, { code: 'Space' })

    expect(listeners?.onPointerDown).toHaveBeenCalledTimes(1)
    expect(listeners?.onKeyDown).toHaveBeenCalledTimes(1)
    expect(dndMocks.accessibility.screenReaderInstructions.draggable).toContain('默认')
    expect(dndMocks.accessibility.screenReaderInstructions.draggable).toContain('Research')
    expect(dndMocks.accessibility.screenReaderInstructions.draggable).toContain('Archive')
    expect(announcements.onDragStart({ active })).toContain('Alpha')
    expect(announcements.onDragOver({ active, over: archive })).toContain('Alpha')
    expect(announcements.onDragOver({ active, over: archive })).toContain('Archive')
    expect(announcements.onDragCancel({ active, over: null })).toContain('Alpha')
    expect(dndMocks.droppableData.get('knowledge-base:base-1')).toMatchObject({
      groupId: 'group-1',
      type: 'knowledge-group'
    })

    const activeRect = new DOMRect(0, 0, 220, 32)
    const archiveRect = new DOMRect(0, 100, 220, 32)
    const containers = new Map([
      [
        active.id,
        {
          data: { current: dndMocks.droppableData.get(active.id) },
          disabled: false,
          id: active.id,
          node: { current: activeNode }
        }
      ],
      [
        archive.id,
        {
          data: { current: dndMocks.droppableData.get(archive.id) },
          disabled: false,
          id: archive.id,
          node: { current: archiveNode }
        }
      ]
    ])
    const keyboardEvent = new KeyboardEvent('keydown', { cancelable: true, code: 'ArrowDown' })
    const coordinates = keyboardOptions.coordinateGetter(keyboardEvent, {
      context: {
        active,
        collisionRect: activeRect,
        droppableContainers: {
          get: (id: string) => containers.get(id),
          getEnabled: () => Array.from(containers.values())
        },
        droppableRects: new Map([
          [active.id, activeRect],
          [archive.id, archiveRect]
        ]),
        over: null,
        scrollableAncestors: []
      }
    })

    expect(keyboardEvent.defaultPrevented).toBe(true)
    expect(coordinates).toEqual({ x: 0, y: 100 })
  })

  it('announces a cross-group drop as a move request rather than a completed update', () => {
    renderDragNavigator({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' })],
      groups: [
        createGroup({ id: 'group-1', name: 'Research' }),
        createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a1' })
      ]
    })

    const announcement = dndMocks.accessibility.announcements.onDragEnd({
      active: getDragEntry('base-1'),
      over: getDropEntry('group-2')
    })

    expect(announcement).toBe('已在 Archive 放下 Alpha，正在请求移动。')
    expect(announcement).not.toContain('已将 Alpha 移至 Archive')
  })

  it('announces that a same-group drop did not move the knowledge base', () => {
    renderDragNavigator({
      bases: [createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' })],
      groups: [createGroup({ id: 'group-1', name: 'Research' })]
    })

    expect(
      dndMocks.accessibility.announcements.onDragEnd({
        active: getDragEntry('base-1'),
        over: getDropEntry('group-1')
      })
    ).toBe('Alpha 仍在 Research，未移动。')
  })

  it('mounts empty, collapsed, and ungrouped accordion items as concrete drop targets', () => {
    renderDragNavigator({
      bases: [
        createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' }),
        createKnowledgeBase({ id: 'base-2', name: 'Gamma', groupId: null })
      ],
      groups: [
        createGroup({ id: 'group-1', name: 'Research' }),
        createGroup({ id: 'group-2', name: 'Archive', orderKey: 'a1' })
      ]
    })

    fireEvent.click(screen.getByRole('button', { name: /Research/ }))

    const researchItem = document.querySelector<HTMLElement>('[data-accordion-item="group-1"]')
    const archiveItem = document.querySelector<HTMLElement>('[data-accordion-item="group-2"]')
    const ungroupedItem = document.querySelector<HTMLElement>('[data-accordion-item="ungrouped"]')

    expect(screen.queryByRole('button', { name: /Alpha/ })).not.toBeInTheDocument()
    expect(researchItem).toContainElement(screen.getByRole('button', { name: /Research/ }))
    expect(archiveItem).toContainElement(screen.getByRole('button', { name: /Archive/ }))
    expect(ungroupedItem).toContainElement(screen.getByRole('button', { name: /默认/ }))
    expect(dndMocks.droppableNodes.get('knowledge-group:id:group-1')).toBe(researchItem)
    expect(dndMocks.droppableNodes.get('knowledge-group:id:group-2')).toBe(archiveItem)
    expect(dndMocks.droppableNodes.get('knowledge-group:ungrouped')).toBe(ungroupedItem)
  })

  it('offers group creation instead of move-to when an ungrouped base has no group targets', async () => {
    const onCreateGroup = vi.fn()

    render(
      <BaseNavigator
        bases={[createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: null })]}
        groups={[]}
        width={280}
        selectedBaseId="base-1"
        onSelectBase={vi.fn()}
        onCreateGroup={onCreateGroup}
        onCreateBase={vi.fn()}
        onMoveBase={vi.fn()}
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: /Alpha/ }), { clientX: 240, clientY: 320 })

    expect(screen.queryByText('移动到')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除知识库' })).toBeInTheDocument()

    fireEvent.click(getMenuButton('新建分组'))

    // The context menu defers item actions to a microtask, so wait for it.
    await waitFor(() => expect(onCreateGroup).toHaveBeenCalledWith('base-1'))
  })

  it('offers group creation at the bottom of the move-to menu for a grouped base', async () => {
    const onCreateGroup = vi.fn()

    render(
      <BaseNavigator
        bases={[createKnowledgeBase({ id: 'base-1', name: 'Alpha', groupId: 'group-1' })]}
        groups={[createGroup({ id: 'group-1', name: 'Research' })]}
        width={280}
        selectedBaseId="base-1"
        onSelectBase={vi.fn()}
        onCreateGroup={onCreateGroup}
        onCreateBase={vi.fn()}
        onMoveBase={vi.fn()}
        onRenameBase={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onDeleteBase={vi.fn()}
        onResizeStart={vi.fn()}
      />
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: /Alpha/ }), { clientX: 240, clientY: 320 })

    expect(screen.getByText('移动到')).toBeInTheDocument()

    fireEvent.click(getMenuButton('新建分组'))

    await waitFor(() => expect(onCreateGroup).toHaveBeenCalledWith('base-1'))
  })

  it('opens the knowledge base menu on right click', () => {
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

    fireEvent.contextMenu(screen.getByRole('button', { name: /Alpha/ }), { clientX: 240, clientY: 320 })

    expect(screen.getByRole('button', { name: '重命名' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '删除知识库' })).toBeInTheDocument()
  })

  it('keeps context menus anchored to the pointer position on right click', () => {
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

    fireEvent.contextMenu(screen.getByRole('button', { name: /Alpha/ }), { clientX: 240, clientY: 320 })

    expect(screen.getByRole('button', { name: '重命名' })).toBeInTheDocument()
  })

  it('calls onRenameBase with the current knowledge base id and name', async () => {
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

    fireEvent.contextMenu(screen.getByRole('button', { name: /Alpha/ }), { clientX: 240, clientY: 320 })
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))

    await waitFor(() => {
      expect(onRenameBase).toHaveBeenCalledWith({
        id: 'base-1',
        name: 'Alpha'
      })
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

    await waitFor(() => expect(screen.getByText('确认删除知识库')).toBeInTheDocument())
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

  it('calls onRenameGroup with the current group id and name', async () => {
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

    await waitFor(() => {
      expect(onRenameGroup).toHaveBeenCalledWith({
        id: 'group-1',
        name: 'Research'
      })
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

    await waitFor(() => expect(screen.getByText('确认删除分组')).toBeInTheDocument())
    expect(screen.getByText('删除后，该分组下的知识库将移至默认分组。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(onDeleteGroup).toHaveBeenCalledWith('group-1')
    })
  })

  it('opens create knowledge base with the current group id from the group menu', async () => {
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

    await waitFor(() => expect(onCreateBase).toHaveBeenCalledWith('group-1'))
  })

  it('renders no group header in the flat ungrouped layout, only base rows with their more button', () => {
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
    expect(screen.queryByText('默认')).not.toBeInTheDocument()
    // No group header/section chrome in the flat layout; each base row still carries its own
    // hover "more" button (the same menu as right-click), so one is present for the single base.
    expect(screen.getByRole('button', { name: '更多' })).toBeInTheDocument()
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

    expect(screen.getByRole('button', { name: /Alpha/ }).parentElement).toHaveClass('bg-secondary')

    fireEvent.click(screen.getByRole('button', { name: /Beta/ }))

    expect(onSelectBase).toHaveBeenCalledWith('base-2')
  })

  it('creates a knowledge base directly from the search-row add button', () => {
    const onCreateBase = vi.fn()
    const onCreateGroup = vi.fn()

    render(
      <BaseNavigator
        bases={[]}
        groups={[]}
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

    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    expect(onCreateBase).toHaveBeenCalledTimes(1)
    // No initialGroupId — and in particular not the click's MouseEvent.
    expect(onCreateBase.mock.calls[0]).toHaveLength(0)
    expect(onCreateGroup).not.toHaveBeenCalled()
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
