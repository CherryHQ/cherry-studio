import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type MouseEvent as ReactMouseEvent, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { loggerErrorMock, loggerWarnMock, preferenceValues, showNativePopupMenuMock } = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  preferenceValues: {
    'menu.presentation_mode': 'native'
  } as Record<string, unknown>,
  showNativePopupMenuMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: loggerErrorMock,
      warn: loggerWarnMock
    })
  }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => [preferenceValues[key] ?? false, vi.fn()],
  useMultiplePreferences: () => [preferenceValues, vi.fn()]
}))

vi.mock('@renderer/utils/platform', () => ({
  isMac: true,
  platform: 'darwin'
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => {
  const React = require('react')
  const MenuOpenContext = React.createContext(null)

  return {
    ContextMenu: ({
      children,
      onOpenChange
    }: {
      children: React.ReactNode
      onOpenChange?: (open: boolean) => void
    }) => (
      <MenuOpenContext value={onOpenChange ?? null}>
        <div>{children}</div>
      </MenuOpenContext>
    ),
    ContextMenuTrigger: ({
      children,
      onContextMenu
    }: {
      children: React.ReactNode
      onContextMenu?: React.MouseEventHandler
    }) => {
      const onOpenChange = React.use(MenuOpenContext)
      const handleContextMenu = (e: React.MouseEvent) => {
        onOpenChange?.(true)
        onContextMenu?.(e)
      }
      return <span onContextMenu={handleContextMenu}>{children}</span>
    },
    ContextMenuContent: ({ children, ...props }: React.ComponentProps<'div'>) => (
      <div data-testid="menu-content" {...props}>
        {children}
      </div>
    ),
    ContextMenuSeparator: () => <hr />,
    ContextMenuSub: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ContextMenuSubContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ContextMenuSubTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ContextMenuCheckboxItem: ({
      children,
      disabled,
      onCheckedChange
    }: {
      children: React.ReactNode
      disabled?: boolean
      onCheckedChange?: () => void
    }) => (
      <button type="button" disabled={disabled} onClick={onCheckedChange}>
        {children}
      </button>
    ),
    ContextMenuItem: ({
      children,
      disabled,
      onSelect
    }: {
      children: React.ReactNode
      disabled?: boolean
      onSelect?: () => void
    }) => (
      <button type="button" disabled={disabled} onClick={onSelect}>
        {children}
      </button>
    ),
    ContextMenuItemContent: ({
      children,
      icon,
      shortcut
    }: {
      children: React.ReactNode
      icon?: React.ReactNode
      shortcut?: string
    }) => (
      <span>
        {icon}
        <span>{children}</span>
        {shortcut ? <span>{shortcut}</span> : null}
      </span>
    ),

    DropdownMenu: ({
      children,
      onOpenChange
    }: {
      children: React.ReactNode
      onOpenChange?: (open: boolean) => void
    }) => (
      <MenuOpenContext value={onOpenChange ?? null}>
        <div>{children}</div>
      </MenuOpenContext>
    ),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => {
      const onOpenChange = React.use(MenuOpenContext)
      const handleClick = () => {
        onOpenChange?.(true)
      }
      return <span onClick={handleClick}>{children}</span>
    },
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="dropdown-menu-content">{children}</div>
    ),
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuSubTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuCheckboxItem: ({
      children,
      disabled,
      onCheckedChange
    }: {
      children: React.ReactNode
      disabled?: boolean
      onCheckedChange?: () => void
    }) => (
      <button type="button" disabled={disabled} onClick={onCheckedChange}>
        {children}
      </button>
    ),
    DropdownMenuItem: ({
      children,
      disabled,
      onSelect
    }: {
      children: React.ReactNode
      disabled?: boolean
      onSelect?: () => void
    }) => (
      <button type="button" disabled={disabled} onClick={onSelect}>
        {children}
      </button>
    ),
    Tooltip: ({ children, content }: { children: React.ReactNode; content?: React.ReactNode }) => (
      <span data-testid="mock-tooltip" data-content={typeof content === 'string' ? content : undefined}>
        {children}
      </span>
    ),
    Scrollbar: ({ children, className }: React.HTMLAttributes<HTMLDivElement>) => (
      <div data-testid="mock-scrollbar" className={className}>
        {children}
      </div>
    )
  }
})

import { useCommandHandler } from '@renderer/hooks/command'

import { CommandContextKeyProvider } from '../CommandContextKeyProvider'
import { CommandContextMenu, type CommandContextMenuExtraItem, CommandPopupMenu } from '../CommandMenus'
import { CommandProvider } from '../CommandProvider'

function RegisteredTopicCreate({ onExecute }: { onExecute: () => void }) {
  useCommandHandler('topic.create', onExecute)
  return null
}

function renderMenu({
  extraItems = [],
  onExecute = vi.fn(),
  onOpenChange,
  getExtraItems,
  pendingExtraItems,
  location = 'chat.input.tools.context'
}: {
  extraItems?: readonly CommandContextMenuExtraItem[]
  onExecute?: () => void
  onOpenChange?: (open: boolean) => void
  getExtraItems?: (
    event: ReactMouseEvent
  ) => readonly CommandContextMenuExtraItem[] | PromiseLike<readonly CommandContextMenuExtraItem[]>
  pendingExtraItems?: readonly CommandContextMenuExtraItem[]
  location?: Parameters<typeof CommandContextMenu>[0]['location']
} = {}) {
  return render(
    <CommandContextKeyProvider>
      <CommandProvider>
        <RegisteredTopicCreate onExecute={onExecute} />
        <CommandContextMenu
          location={location}
          extraItems={extraItems}
          pendingExtraItems={pendingExtraItems}
          onOpenChange={onOpenChange}
          getExtraItems={getExtraItems}>
          <button type="button">trigger</button>
        </CommandContextMenu>
      </CommandProvider>
    </CommandContextKeyProvider>
  )
}

describe('CommandContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    preferenceValues['menu.presentation_mode'] = 'native'
    window.api = {
      command: {
        showNativePopupMenu: showNativePopupMenuMock
      }
    } as never
  })

  afterEach(() => {
    cleanup()
  })

  it('passes command and extra items to the native menu and runs the selected extra action', async () => {
    const onSelect = vi.fn()
    showNativePopupMenuMock.mockResolvedValueOnce({ type: 'custom', id: 'tool:web-search' })

    renderMenu({
      extraItems: [{ type: 'item', id: 'tool:web-search', label: 'Web Search', checked: true, onSelect }]
    })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'trigger' }))

    await waitFor(() => {
      expect(showNativePopupMenuMock).toHaveBeenCalledWith(
        expect.objectContaining({
          location: 'chat.input.tools.context',
          items: expect.arrayContaining([
            expect.objectContaining({ type: 'command', command: 'topic.create' }),
            expect.objectContaining({ type: 'custom', id: 'tool:web-search', checked: true })
          ])
        }),
        expect.any(Object)
      )
      expect(onSelect).toHaveBeenCalledOnce()
    })
  })

  it('runs extra submenu actions selected from the native menu result', async () => {
    const onSelect = vi.fn()
    showNativePopupMenuMock.mockResolvedValueOnce({ type: 'custom', id: 'topic:copy:markdown' })

    renderMenu({
      extraItems: [
        {
          type: 'submenu',
          id: 'topic:copy',
          label: 'Copy',
          children: [{ type: 'item', id: 'topic:copy:markdown', label: 'Markdown', onSelect }]
        }
      ]
    })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'trigger' }))

    await waitFor(() => {
      expect(showNativePopupMenuMock).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({
              type: 'submenu',
              label: 'Copy',
              children: [expect.objectContaining({ type: 'custom', id: 'topic:copy:markdown' })]
            })
          ])
        }),
        expect.any(Object)
      )
      expect(onSelect).toHaveBeenCalledOnce()
    })
  })

  it('executes renderer commands selected from the native menu result', async () => {
    const onExecute = vi.fn()
    showNativePopupMenuMock.mockResolvedValueOnce({ type: 'command', command: 'topic.create' })

    renderMenu({ onExecute })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'trigger' }))

    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledOnce()
    })
  })

  it('triggers onOpenChange around native context menus', async () => {
    const onOpenChange = vi.fn()
    showNativePopupMenuMock.mockResolvedValueOnce(null)

    renderMenu({
      location: 'webcontents.context',
      onOpenChange,
      extraItems: [{ type: 'item', id: 'tool:branch', label: 'Branch', onSelect: vi.fn() }]
    })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'trigger' }))

    expect(onOpenChange).toHaveBeenCalledWith(true)

    await waitFor(() => {
      expect(showNativePopupMenuMock).toHaveBeenCalled()
      expect(onOpenChange).toHaveBeenLastCalledWith(false)
    })
  })

  it('uses event-time extra items for native menus', async () => {
    const onSelect = vi.fn()
    showNativePopupMenuMock.mockResolvedValueOnce({ type: 'custom', id: 'tool:fresh' })

    renderMenu({
      extraItems: [{ type: 'item', id: 'tool:stale', label: 'Stale', onSelect: vi.fn() }],
      getExtraItems: () => [{ type: 'item', id: 'tool:fresh', label: 'Fresh', onSelect }]
    })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'trigger' }))

    await waitFor(() => {
      expect(showNativePopupMenuMock).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ type: 'custom', id: 'tool:fresh' })])
        }),
        expect.any(Object)
      )
      expect(onSelect).toHaveBeenCalledOnce()
    })
  })

  it('resolves extra item shortcutCommand before showing native menus', async () => {
    showNativePopupMenuMock.mockResolvedValueOnce(undefined)

    renderMenu({
      extraItems: [
        {
          type: 'item',
          id: 'topic:rename',
          label: 'Rename Topic',
          shortcutCommand: 'topic.create',
          onSelect: vi.fn()
        }
      ]
    })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'trigger' }))

    await waitFor(() => {
      expect(showNativePopupMenuMock).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ type: 'custom', id: 'topic:rename', shortcutLabel: '⌘N' })
          ])
        }),
        expect.any(Object)
      )
    })
  })

  it('renders and selects extra items in cherry mode', async () => {
    const onSelect = vi.fn()
    preferenceValues['menu.presentation_mode'] = 'cherry'

    renderMenu({ extraItems: [{ type: 'item', id: 'tool:web-search', label: 'Web Search', onSelect }] })

    expect(screen.getByText('Web Search')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Web Search/ }))

    await waitFor(() => expect(onSelect).toHaveBeenCalledOnce())
  })

  it('runs selected cherry menu actions after closing even if the menu unmounts', () => {
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()
    const deferredActions: FrameRequestCallback[] = []
    const requestFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      deferredActions.push(callback)
      return deferredActions.length
    })
    preferenceValues['menu.presentation_mode'] = 'cherry'

    const { unmount } = renderMenu({
      onOpenChange,
      extraItems: [{ type: 'item', id: 'tool:web-search', label: 'Web Search', onSelect }]
    })

    fireEvent.contextMenu(screen.getByRole('button', { name: 'trigger' }))
    fireEvent.click(screen.getByRole('button', { name: /Web Search/ }))

    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(requestFrameSpy).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Web Search/ }))
    unmount()

    deferredActions[0]?.(0)
    deferredActions[1]?.(0)
    expect(onSelect).toHaveBeenCalledTimes(2)
    requestFrameSpy.mockRestore()
  })

  it('stops cherry context-menu events after an inner menu handles them', () => {
    const outerOpenChange = vi.fn()
    const innerOpenChange = vi.fn()
    preferenceValues['menu.presentation_mode'] = 'cherry'

    render(
      <CommandContextKeyProvider>
        <CommandProvider>
          <CommandContextMenu
            location="webcontents.context"
            onOpenChange={outerOpenChange}
            extraItems={[{ type: 'item', id: 'outer:action', label: 'Outer Action', onSelect: vi.fn() }]}>
            <div>
              <CommandContextMenu
                location="webcontents.context"
                onOpenChange={innerOpenChange}
                extraItems={[{ type: 'item', id: 'inner:action', label: 'Inner Action', onSelect: vi.fn() }]}>
                <button type="button">inner trigger</button>
              </CommandContextMenu>
            </div>
          </CommandContextMenu>
        </CommandProvider>
      </CommandContextKeyProvider>
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'inner trigger' }))

    expect(innerOpenChange).toHaveBeenCalledWith(true)
    expect(outerOpenChange).not.toHaveBeenCalled()
  })

  it('stops pointer and mouse down events from bubbling out of cherry context menu content', () => {
    const onPointerDown = vi.fn()
    const onMouseDown = vi.fn()
    preferenceValues['menu.presentation_mode'] = 'cherry'

    render(
      <div onPointerDown={onPointerDown} onMouseDown={onMouseDown}>
        <CommandContextKeyProvider>
          <CommandProvider>
            <RegisteredTopicCreate onExecute={vi.fn()} />
            <CommandContextMenu
              location="webcontents.context"
              extraItems={[{ type: 'item', id: 'tool:web-search', label: 'Web Search', onSelect: vi.fn() }]}>
              <button type="button">trigger</button>
            </CommandContextMenu>
          </CommandProvider>
        </CommandContextKeyProvider>
      </div>
    )

    const menuContent = screen.getByTestId('menu-content')
    fireEvent.pointerDown(menuContent)
    fireEvent.mouseDown(menuContent)

    expect(onPointerDown).not.toHaveBeenCalled()
    expect(onMouseDown).not.toHaveBeenCalled()
  })

  it('renders extra item shortcutCommand in cherry mode', () => {
    preferenceValues['menu.presentation_mode'] = 'cherry'

    renderMenu({
      extraItems: [
        {
          type: 'item',
          id: 'topic:rename',
          label: 'Rename Topic',
          shortcutCommand: 'topic.create',
          onSelect: vi.fn()
        }
      ]
    })

    expect(screen.getByRole('button', { name: /Rename Topic/ })).toHaveTextContent('⌘N')
  })

  it('uses async extra items for native menus', async () => {
    const onSelect = vi.fn()
    showNativePopupMenuMock.mockResolvedValueOnce({ type: 'custom', id: 'tool:async' })

    renderMenu({
      location: 'webcontents.context',
      getExtraItems: async () => [{ type: 'item', id: 'tool:async', label: 'Async Tool', onSelect }]
    })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'trigger' }))

    await waitFor(() => {
      expect(showNativePopupMenuMock).toHaveBeenCalledWith(
        expect.objectContaining({
          location: 'webcontents.context',
          items: [expect.objectContaining({ type: 'custom', id: 'tool:async' })]
        }),
        expect.any(Object)
      )
      expect(onSelect).toHaveBeenCalledOnce()
    })
  })

  it('ignores stale async native extra items', async () => {
    const firstSelect = vi.fn()
    const secondSelect = vi.fn()
    let resolveFirst: (items: readonly CommandContextMenuExtraItem[]) => void = () => {}
    showNativePopupMenuMock.mockResolvedValue({ type: 'custom', id: 'tool:second' })
    const getExtraItems = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<readonly CommandContextMenuExtraItem[]>((resolve) => {
          resolveFirst = resolve
        })
      )
      .mockResolvedValueOnce([{ type: 'item', id: 'tool:second', label: 'Second Tool', onSelect: secondSelect }])

    renderMenu({ location: 'webcontents.context', getExtraItems })
    const trigger = screen.getByRole('button', { name: 'trigger' })
    fireEvent.contextMenu(trigger)
    fireEvent.contextMenu(trigger)

    await waitFor(() => {
      expect(showNativePopupMenuMock).toHaveBeenCalledTimes(1)
      expect(secondSelect).toHaveBeenCalledOnce()
    })

    resolveFirst([{ type: 'item', id: 'tool:first', label: 'First Tool', onSelect: firstSelect }])
    await Promise.resolve()
    await Promise.resolve()

    expect(showNativePopupMenuMock).toHaveBeenCalledTimes(1)
    expect(firstSelect).not.toHaveBeenCalled()
  })

  it('keeps lazy cherry menus mounted without rendering empty content when static items are empty', async () => {
    preferenceValues['menu.presentation_mode'] = 'cherry'
    const getExtraItems = vi.fn().mockResolvedValue([])

    renderMenu({ location: 'chat.message.context', getExtraItems })
    await act(async () => {
      fireEvent.contextMenu(screen.getByRole('button', { name: 'trigger' }))
      await Promise.resolve()
    })

    expect(getExtraItems).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('menu-content')).not.toBeInTheDocument()
  })

  it('renders cherry menu content when a lazy resolver returns extra items', async () => {
    preferenceValues['menu.presentation_mode'] = 'cherry'

    renderMenu({
      location: 'chat.message.context',
      getExtraItems: () => [{ type: 'item', id: 'tool:fresh', label: 'Fresh Tool', onSelect: vi.fn() }]
    })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'trigger' }))

    expect(await screen.findByText('Fresh Tool')).toBeInTheDocument()
    expect(screen.getByTestId('menu-content')).toBeInTheDocument()
  })

  it('renders async extra items in cherry mode', async () => {
    const onSelect = vi.fn()
    preferenceValues['menu.presentation_mode'] = 'cherry'

    renderMenu({
      location: 'webcontents.context',
      pendingExtraItems: [{ type: 'item', id: 'tool:pending', label: 'Loading Tool', enabled: false, onSelect }],
      getExtraItems: async () => [{ type: 'item', id: 'tool:async', label: 'Async Tool', onSelect }]
    })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'trigger' }))

    expect(screen.getByText('Loading Tool')).toBeInTheDocument()
    expect(await screen.findByText('Async Tool')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Async Tool/ }))

    await waitFor(() => expect(onSelect).toHaveBeenCalledOnce())
  })

  it('does not remount trigger children after selecting a cherry extra item', async () => {
    const onSelect = vi.fn()
    const mountCount = vi.fn()
    const unmountCount = vi.fn()
    preferenceValues['menu.presentation_mode'] = 'cherry'

    function TriggerContent() {
      useEffect(() => {
        mountCount()
        return unmountCount
      }, [])

      return <button type="button">trigger</button>
    }

    render(
      <CommandContextKeyProvider>
        <CommandProvider>
          <CommandContextMenu
            location="webcontents.context"
            extraItems={[{ type: 'item', id: 'tool:branch', label: 'Branch', onSelect }]}>
            <TriggerContent />
          </CommandContextMenu>
        </CommandProvider>
      </CommandContextKeyProvider>
    )

    await waitFor(() => expect(mountCount).toHaveBeenCalledOnce())

    fireEvent.contextMenu(screen.getByRole('button', { name: 'trigger' }))
    fireEvent.click(screen.getByRole('button', { name: /Branch/ }))

    await waitFor(() => expect(onSelect).toHaveBeenCalledOnce())
    expect(unmountCount).not.toHaveBeenCalled()
    expect(mountCount).toHaveBeenCalledOnce()
  })

  it('uses extra items as pending lazy cherry items by default', async () => {
    preferenceValues['menu.presentation_mode'] = 'cherry'
    let resolveItems: (items: readonly CommandContextMenuExtraItem[]) => void = () => {}

    renderMenu({
      location: 'webcontents.context',
      extraItems: [{ type: 'item', id: 'tool:current', label: 'Current Tool', enabled: false, onSelect: vi.fn() }],
      getExtraItems: () =>
        new Promise<readonly CommandContextMenuExtraItem[]>((resolve) => {
          resolveItems = resolve
        })
    })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'trigger' }))

    expect(screen.getByText('Current Tool')).toBeInTheDocument()

    act(() => {
      resolveItems([{ type: 'item', id: 'tool:fresh', label: 'Fresh Tool', onSelect: vi.fn() }])
    })

    expect(await screen.findByText('Fresh Tool')).toBeInTheDocument()
  })

  it('falls back to empty extra items when async resolver fails', async () => {
    preferenceValues['menu.presentation_mode'] = 'cherry'

    renderMenu({
      location: 'webcontents.context',
      getExtraItems: async () => {
        throw new Error('probe failed')
      }
    })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'trigger' }))

    await waitFor(() => {
      expect(loggerWarnMock).toHaveBeenCalledWith('Failed to resolve command menu extra items', expect.any(Error))
    })
  })

  it('triggers onOpenChange(true) when clicked in native mode, and onOpenChange(false) when closed', async () => {
    const onOpenChange = vi.fn()
    showNativePopupMenuMock.mockResolvedValueOnce(null)

    render(
      <CommandContextKeyProvider>
        <CommandProvider>
          <CommandPopupMenu
            location="webcontents.context"
            onOpenChange={onOpenChange}
            extraItems={[{ type: 'item', id: 'tool:branch', label: 'Branch', onSelect: vi.fn() }]}>
            <button type="button">trigger-popup</button>
          </CommandPopupMenu>
        </CommandProvider>
      </CommandContextKeyProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'trigger-popup' }))

    expect(onOpenChange).toHaveBeenCalledWith(true)

    await waitFor(() => {
      expect(showNativePopupMenuMock).toHaveBeenCalled()
      expect(onOpenChange).toHaveBeenLastCalledWith(false)
    })
  })

  it('triggers onOpenChange(true) when clicked in cherry mode, and onOpenChange(false) when selecting item', async () => {
    preferenceValues['menu.presentation_mode'] = 'cherry'
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    render(
      <CommandContextKeyProvider>
        <CommandProvider>
          <CommandPopupMenu
            location="webcontents.context"
            onOpenChange={onOpenChange}
            extraItems={[{ type: 'item', id: 'tool:branch', label: 'Branch', onSelect }]}>
            <button type="button">trigger-popup</button>
          </CommandPopupMenu>
        </CommandProvider>
      </CommandContextKeyProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'trigger-popup' }))
    expect(onOpenChange).toHaveBeenNthCalledWith(1, true)

    fireEvent.click(screen.getByRole('button', { name: /Branch/ }))
    expect(onOpenChange).toHaveBeenNthCalledWith(2, false)

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledOnce()
    })
  })

  it('keeps disabled popup extra item descriptions in a tooltip in cherry mode', () => {
    preferenceValues['menu.presentation_mode'] = 'cherry'
    const onSelect = vi.fn()

    render(
      <CommandContextKeyProvider>
        <CommandProvider>
          <CommandPopupMenu
            location="webcontents.context"
            extraItems={[
              {
                type: 'item',
                id: 'tool:branch',
                label: 'New Branch',
                description: 'You are already at the end of this branch.',
                enabled: false,
                onSelect
              }
            ]}>
            <button type="button">trigger-popup</button>
          </CommandPopupMenu>
        </CommandProvider>
      </CommandContextKeyProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'trigger-popup' }))

    expect(screen.getByText('New Branch')).toBeInTheDocument()
    expect(screen.queryByText('You are already at the end of this branch.')).not.toBeInTheDocument()
    expect(screen.getByTestId('mock-tooltip')).toHaveAttribute(
      'data-content',
      'You are already at the end of this branch.'
    )

    fireEvent.click(screen.getByRole('button', { name: /New Branch/ }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('triggers onOpenChange(true) when right-clicked in cherry mode, and onOpenChange(false) when selecting item', async () => {
    preferenceValues['menu.presentation_mode'] = 'cherry'
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    render(
      <CommandContextKeyProvider>
        <CommandProvider>
          <CommandContextMenu
            location="webcontents.context"
            onOpenChange={onOpenChange}
            extraItems={[{ type: 'item', id: 'tool:branch', label: 'Branch', onSelect }]}>
            <button type="button">trigger-context</button>
          </CommandContextMenu>
        </CommandProvider>
      </CommandContextKeyProvider>
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'trigger-context' }))
    expect(onOpenChange).toHaveBeenNthCalledWith(1, true)

    fireEvent.click(screen.getByRole('button', { name: /Branch/ }))
    expect(onOpenChange).toHaveBeenNthCalledWith(2, false)

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledOnce()
    })
  })
})
