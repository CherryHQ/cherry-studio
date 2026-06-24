import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'
import type { Group } from '@shared/data/types/group'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type * as ReactModule from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import BaseNavigator from '../navigator'

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
    t: (key: string, options?: { count?: number }) =>
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

const getMenuButton = (name: string) => {
  const button = screen
    .getAllByRole('button', { name })
    .find((element) => element.getAttribute('data-active') === 'false')

  if (!button) {
    throw new Error(`Missing menu button for ${name}`)
  }

  return button
}

describe('BaseNavigator', () => {
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

    expect(container.querySelector('.min-h-0.flex-1')).toHaveClass('overflow-x-hidden', 'px-3', 'pb-3')
    expect(container.querySelector('.min-h-0.flex-1')?.className).not.toContain('[scrollbar-gutter:auto]')
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

  it('places group counts next to their labels inside the trigger', () => {
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

    expect(within(screen.getByRole('button', { name: /默认/ })).getByText('1')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /Research/ })).getByText('1')).toBeInTheDocument()
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

  it('renders ungrouped bases under the default knowledge group', () => {
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
    expect(screen.getByText('默认')).toBeInTheDocument()
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

    fireEvent.contextMenu(screen.getByRole('button', { name: /Alpha/ }), { clientX: 240, clientY: 320 })

    expect(screen.queryByText('移动到')).not.toBeInTheDocument()
    expect(screen.getByText('默认')).toBeInTheDocument()
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

    fireEvent.click(getBaseMoreButton('Alpha'))
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

  it('does not render a group menu trigger for the default knowledge group', () => {
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

    expect(screen.getByText('默认')).toBeInTheDocument()
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

    expect(screen.getByRole('button', { name: /Alpha/ }).parentElement).toHaveClass('bg-secondary')

    fireEvent.click(screen.getByRole('button', { name: /Beta/ }))

    expect(onSelectBase).toHaveBeenCalledWith('base-2')
  })

  it('forwards group creation from the search-row create menu on click', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '新建分组' }))

    expect(onCreateGroup).toHaveBeenCalledTimes(1)
    expect(onCreateBase).not.toHaveBeenCalled()
    expect(screen.getByText('Research')).toBeInTheDocument()
  })

  it('forwards knowledge base creation from the search-row create menu on click', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '新建知识库' }))

    expect(onCreateBase).toHaveBeenCalledTimes(1)
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
