import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fireEvent, render, screen } from '@testing-library/react'
import type { LucideIcon } from 'lucide-react'
import { Search } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getSidebarDisplayWidth,
  normalizeSidebarWidth,
  SIDEBAR_FULL_THRESHOLD,
  SIDEBAR_HIDDEN_THRESHOLD,
  SIDEBAR_ICON_WIDTH,
  SIDEBAR_MAX_WIDTH
} from '../constants'
import { MiniAppIcon } from '../primitives'
import { Sidebar } from '../Sidebar'
import type { ResolvedSidebarEntry, SidebarMiniAppTab } from '../types'

type AppItem = {
  id: string
  label: string
  icon: LucideIcon
  contextMenuItems?: ResolvedSidebarEntry['contextMenuItems']
}

const uiMocks = vi.hoisted(() => ({
  sortableCalls: [] as any[]
}))

vi.mock('@cherrystudio/ui', () => ({
  MenuItem: ({
    icon,
    label,
    onClick,
    className,
    active
  }: {
    icon?: ReactNode
    label: string
    onClick?: () => void
    className?: string
    active?: boolean
  }) => (
    <button type="button" data-active={active ? 'true' : 'false'} className={className} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  ),
  Sortable: ({ items, itemKey, renderItem, ...props }: any) => {
    uiMocks.sortableCalls.push({ items, itemKey, renderItem, ...props })
    const getKey = typeof itemKey === 'function' ? itemKey : (item: any) => item[itemKey]

    return (
      <div>
        {items.map((item: any) => (
          <div key={getKey(item)}>{renderItem(item)}</div>
        ))}
      </div>
    )
  }
}))

vi.mock('../Tooltip', () => ({
  SidebarTooltip: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => false
}))

vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({
    children,
    extraItems,
    onOpenChange
  }: {
    children: ReactNode
    extraItems: ReadonlyArray<{ id: string; label: string; enabled?: boolean; onSelect?: () => void }>
    onOpenChange?: (open: boolean) => void
  }) => (
    <div data-testid="command-context-menu">
      {children}
      {onOpenChange && (
        <>
          <button type="button" data-testid="context-menu-open" onClick={() => onOpenChange(true)} />
          <button type="button" data-testid="context-menu-close" onClick={() => onOpenChange(false)} />
        </>
      )}
      {extraItems.map((item) => (
        <button
          key={item.id}
          type="button"
          data-testid={`context-menu-${item.id}`}
          disabled={item.enabled === false}
          onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </div>
  )
}))

vi.mock('@renderer/components/icons/miniAppsLogo', () => {
  const QwenLogo = ({ style, ...props }: { style?: CSSProperties }) => (
    <svg data-testid="resolved-mini-app-logo" style={style} {...props} />
  )
  QwenLogo.Avatar = ({ size }: { size: number }) => (
    <span data-size={size} data-testid="resolved-mini-app-logo-avatar" />
  )
  return {
    getMiniAppsLogoRef: (logo?: string) =>
      logo === 'qwen' ? { kind: 'provider', key: 'qwen', meta: { id: 'qwen', colorPrimary: '#000' } } : undefined,
    useMiniAppLogo: (logo?: string) => (logo === 'qwen' ? QwenLogo : undefined)
  }
})

// Build the type-agnostic resolved entries the real registry would produce, so the
// presentation tests exercise the same shape without depending on app wiring.
const appEntry = (item: AppItem): ResolvedSidebarEntry => ({
  key: `app:${item.id}`,
  label: item.label,
  renderIcon: (size) => {
    const Icon = item.icon
    return <Icon size={size} />
  },
  isActive: (active) => active.activeItem === item.id,
  onOpen: () => {},
  contextMenuItems: item.contextMenuItems
})
const miniEntry = (
  tab: SidebarMiniAppTab,
  contextMenuItems?: ResolvedSidebarEntry['contextMenuItems']
): ResolvedSidebarEntry => ({
  key: `mini_app:${tab.miniApp.id}`,
  label: tab.title,
  renderIcon: (_size, miniAppSize) => <MiniAppIcon tab={tab} size={miniAppSize} />,
  isActive: (active) => active.activeTabId === tab.miniApp.id,
  onOpen: () => {},
  contextMenuItems
})

const items: AppItem[] = [
  {
    id: 'chat',
    label: 'Chat',
    icon: Search
  }
]
const entries: ResolvedSidebarEntry[] = items.map(appEntry)

const INTERMEDIATE_WIDTH = SIDEBAR_ICON_WIDTH + 30
const sidebarCss = readFileSync(join(process.cwd(), 'src/renderer/components/Sidebar/Sidebar.css'), 'utf-8')

afterEach(() => {
  uiMocks.sortableCalls.length = 0
})

function dragResizeFrom(width: number, moves: number | number[]) {
  const setWidth = vi.fn()
  const onResizePreview = vi.fn()
  const onHoverChange = vi.fn()
  const { container, unmount } = render(
    <Sidebar
      width={width}
      setWidth={setWidth}
      active={{ activeItem: 'chat' }}
      entries={entries}
      onHoverChange={onHoverChange}
      onResizePreview={onResizePreview}
    />
  )
  const resizeHandle = container.querySelector('.cursor-col-resize') as HTMLElement

  fireEvent.mouseDown(resizeHandle, { clientX: width })
  for (const clientX of [moves].flat()) {
    fireEvent.mouseMove(document, { clientX })
  }
  fireEvent.mouseUp(document)

  return { setWidth, onResizePreview, onHoverChange, unmount }
}

describe('Sidebar resize handle', () => {
  it('keeps the existing handle width and opts out of window drag regions', () => {
    const { container } = render(
      <Sidebar width={SIDEBAR_ICON_WIDTH} setWidth={vi.fn()} active={{ activeItem: 'chat' }} entries={entries} />
    )

    const resizeHandle = container.querySelector('.cursor-col-resize')

    expect(resizeHandle).toBeInTheDocument()
    expect(resizeHandle).toHaveClass('w-0.75')
    expect(resizeHandle).toHaveClass('[-webkit-app-region:no-drag]')
  })

  it('previews intermediate widths and snaps release by drag direction', () => {
    const cases: Array<[number, number, number]> = [
      [SIDEBAR_ICON_WIDTH, INTERMEDIATE_WIDTH, SIDEBAR_FULL_THRESHOLD],
      [SIDEBAR_FULL_THRESHOLD, INTERMEDIATE_WIDTH, SIDEBAR_ICON_WIDTH],
      [SIDEBAR_FULL_THRESHOLD + 50, SIDEBAR_FULL_THRESHOLD - 10, SIDEBAR_ICON_WIDTH]
    ]

    for (const [start, moveTo, released] of cases) {
      const { setWidth, onResizePreview, unmount } = dragResizeFrom(start, moveTo)

      expect(onResizePreview).toHaveBeenNthCalledWith(1, moveTo)
      expect(onResizePreview).toHaveBeenLastCalledWith(null)
      expect(setWidth).toHaveBeenCalledTimes(1)
      expect(setWidth).toHaveBeenLastCalledWith(released)
      unmount()
    }
  })

  it('keeps non-intermediate drag behavior', () => {
    const cases: Array<[number, number]> = [
      [SIDEBAR_HIDDEN_THRESHOLD - 10, 0],
      [SIDEBAR_HIDDEN_THRESHOLD + 10, SIDEBAR_ICON_WIDTH],
      [SIDEBAR_FULL_THRESHOLD + 10, SIDEBAR_FULL_THRESHOLD + 10],
      [SIDEBAR_MAX_WIDTH + 20, SIDEBAR_MAX_WIDTH]
    ]

    for (const [moveTo, expected] of cases) {
      const { setWidth, unmount } = dragResizeFrom(SIDEBAR_FULL_THRESHOLD, moveTo)

      expect(setWidth).toHaveBeenCalledTimes(1)
      expect(setWidth).toHaveBeenLastCalledWith(expected)
      unmount()
    }
  })

  it('clears the preview when a multi-step drag leaves the intermediate band', () => {
    const { setWidth, onResizePreview } = dragResizeFrom(SIDEBAR_ICON_WIDTH, [
      INTERMEDIATE_WIDTH,
      SIDEBAR_FULL_THRESHOLD + 10
    ])

    expect(onResizePreview).toHaveBeenNthCalledWith(1, INTERMEDIATE_WIDTH)
    expect(onResizePreview).toHaveBeenNthCalledWith(2, null)
    expect(setWidth).toHaveBeenCalledTimes(1)
    expect(setWidth).toHaveBeenLastCalledWith(SIDEBAR_FULL_THRESHOLD + 10)
  })

  it('stops tracking the mouse and restores the cursor after release', () => {
    const { setWidth, onResizePreview } = dragResizeFrom(SIDEBAR_FULL_THRESHOLD, SIDEBAR_FULL_THRESHOLD + 10)

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')

    const setWidthCalls = setWidth.mock.calls.length
    const previewCalls = onResizePreview.mock.calls.length

    fireEvent.mouseMove(document, { clientX: SIDEBAR_FULL_THRESHOLD + 40 })

    expect(setWidth).toHaveBeenCalledTimes(setWidthCalls)
    expect(onResizePreview).toHaveBeenCalledTimes(previewCalls)
  })

  it('renders intermediate widths with icon layout without menu text', () => {
    const { container, queryByText } = render(
      <Sidebar width={INTERMEDIATE_WIDTH} setWidth={vi.fn()} active={{ activeItem: 'chat' }} entries={entries} />
    )

    expect(container.firstElementChild).toHaveStyle({ width: `${INTERMEDIATE_WIDTH}px` })
    expect(queryByText('Chat')).not.toBeInTheDocument()
  })

  it('resolves display widths for CSS variable consumers', () => {
    expect(getSidebarDisplayWidth(SIDEBAR_HIDDEN_THRESHOLD + 10)).toBe(SIDEBAR_ICON_WIDTH)
    expect(getSidebarDisplayWidth(INTERMEDIATE_WIDTH)).toBe(INTERMEDIATE_WIDTH)
    expect(getSidebarDisplayWidth(SIDEBAR_FULL_THRESHOLD)).toBe(SIDEBAR_FULL_THRESHOLD)
  })

  it('normalizes persisted intermediate widths to icon width', () => {
    expect(normalizeSidebarWidth(SIDEBAR_ICON_WIDTH)).toBe(SIDEBAR_ICON_WIDTH)
    expect(normalizeSidebarWidth(INTERMEDIATE_WIDTH)).toBe(SIDEBAR_ICON_WIDTH)
    expect(normalizeSidebarWidth(SIDEBAR_FULL_THRESHOLD)).toBe(SIDEBAR_FULL_THRESHOLD)
  })

  it('keeps the hidden-state hot zone full height without moving the resize binding', () => {
    const { container } = render(
      <Sidebar
        width={SIDEBAR_HIDDEN_THRESHOLD - 10}
        setWidth={vi.fn()}
        active={{ activeItem: 'chat' }}
        entries={entries}
      />
    )

    const resizeHandle = container.querySelector('.cursor-col-resize') as HTMLElement
    const hotZone = resizeHandle.parentElement

    expect(resizeHandle).toHaveClass('h-full', 'w-full', 'cursor-col-resize')
    expect(hotZone).toHaveClass('absolute', 'inset-y-0', 'left-0', 'z-50', 'w-4')
    expect(hotZone).toHaveClass('[-webkit-app-region:no-drag]')
  })

  it('keeps a resize hit zone on the floating sidebar edge', () => {
    const setWidth = vi.fn()
    const onResizingChange = vi.fn()
    const { container } = render(
      <Sidebar
        width={SIDEBAR_HIDDEN_THRESHOLD - 10}
        setWidth={setWidth}
        active={{ activeItem: 'chat' }}
        entries={entries}
        isFloating
        onResizingChange={onResizingChange}
      />
    )

    const panel = container.querySelector('.slide-in-from-left-2')
    const resizeHandle = panel?.querySelector('[data-sidebar-resize-handle]')

    expect(resizeHandle).toBeInTheDocument()
    expect(resizeHandle).toHaveClass('absolute', 'inset-y-0', 'right-0', 'z-50', 'w-2')
    expect(resizeHandle).toHaveClass('[-webkit-app-region:no-drag]')

    fireEvent.mouseDown(resizeHandle as HTMLElement, { clientX: 174 })
    expect(onResizingChange).toHaveBeenLastCalledWith(true)

    fireEvent.mouseMove(document, { clientX: 180 })
    expect(setWidth).toHaveBeenLastCalledWith(180)

    fireEvent.mouseUp(document)
    expect(onResizingChange).toHaveBeenLastCalledWith(false)
  })

  it('restores a hidden sidebar by dragging wider from the hot zone', () => {
    const { setWidth, onResizePreview, onHoverChange } = dragResizeFrom(
      SIDEBAR_HIDDEN_THRESHOLD - 10,
      INTERMEDIATE_WIDTH
    )

    expect(onHoverChange).toHaveBeenCalledWith(false)
    expect(onResizePreview).toHaveBeenNthCalledWith(1, INTERMEDIATE_WIDTH)
    expect(setWidth).toHaveBeenCalledTimes(1)
    expect(setWidth).toHaveBeenLastCalledWith(SIDEBAR_FULL_THRESHOLD)
  })

  it('renders the full layout at the full threshold', () => {
    const { container, getByText } = render(
      <Sidebar width={SIDEBAR_FULL_THRESHOLD} setWidth={vi.fn()} active={{ activeItem: 'chat' }} entries={entries} />
    )

    expect(container.firstElementChild).toHaveStyle({ width: `${SIDEBAR_FULL_THRESHOLD}px` })
    expect(getByText('Chat')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chat' })).toHaveClass('sidebar-entry')
  })

  it('owns full-row hover and active glass styles outside MenuItem utility ordering', () => {
    expect(sidebarCss).toContain('--sidebar-active-bg: var(--app-shell-selected-surface, var(--sidebar-accent))')
    expect(sidebarCss).toContain('--sidebar-active-border: var(--app-shell-selected-border, var(--sidebar-border))')
    expect(sidebarCss).toContain('--sidebar-floating-shadow: rgba(0, 0, 0, 0.25)')
    expect(sidebarCss).toContain('.sidebar-theme .sidebar-entry:hover')
    expect(sidebarCss).toContain('background: var(--sidebar-hover-bg)')
    expect(sidebarCss).toContain(".sidebar-theme .sidebar-entry[data-active='true']")
    expect(sidebarCss).toContain('background: var(--sidebar-active-bg)')
    expect(sidebarCss).toContain('border-color: var(--sidebar-active-border)')
    expect(sidebarCss).toContain('box-shadow: var(--sidebar-active-shadow)')
    expect(sidebarCss).toContain(".app-shell-theme[data-glass-active='true'] .sidebar-entry[data-active='true']")
    expect(sidebarCss).toContain('backdrop-filter: blur(4px)')
  })

  it('wires context menu actions for sidebar app items', () => {
    const onRemove = vi.fn()

    render(
      <Sidebar
        width={SIDEBAR_FULL_THRESHOLD}
        setWidth={vi.fn()}
        active={{ activeItem: 'chat' }}
        entries={[
          appEntry({
            ...items[0],
            contextMenuItems: [{ type: 'item', id: 'remove-chat', label: 'Remove from Sidebar', onSelect: onRemove }]
          })
        ]}
      />
    )

    fireEvent.click(screen.getByTestId('context-menu-remove-chat'))

    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('keeps the floating sidebar open while a context menu is open', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()

    try {
      const { container } = render(
        <Sidebar
          width={SIDEBAR_FULL_THRESHOLD}
          setWidth={vi.fn()}
          active={{ activeItem: 'chat' }}
          entries={[
            appEntry({
              ...items[0],
              contextMenuItems: [{ type: 'item', id: 'remove-chat', label: 'Remove from Sidebar', onSelect: vi.fn() }]
            })
          ]}
          isFloating
          onDismiss={onDismiss}
        />
      )

      const panel = container.querySelector('.slide-in-from-left-2') as HTMLElement

      fireEvent.mouseEnter(panel)
      fireEvent.click(screen.getByTestId('context-menu-open'))
      fireEvent.mouseLeave(panel)
      vi.advanceTimersByTime(350)

      expect(onDismiss).not.toHaveBeenCalled()

      fireEvent.click(screen.getByTestId('context-menu-close'))
      vi.advanceTimersByTime(350)

      expect(onDismiss).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders apps and direct mini app icons together in one full docked list', () => {
    const { container } = render(
      <Sidebar
        width={SIDEBAR_FULL_THRESHOLD}
        setWidth={vi.fn()}
        active={{ activeItem: 'chat' }}
        entries={[
          ...entries,
          miniEntry({
            title: 'Qwen',
            miniApp: { id: 'qwen', logo: 'qwen' }
          })
        ]}
      />
    )

    expect(screen.getByText('Chat')).toBeInTheDocument()
    expect(screen.getByText('Qwen')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="resolved-mini-app-logo-avatar"]')).not.toBeInTheDocument()
    expect(container.querySelector('[data-testid="resolved-mini-app-logo"]')).toHaveStyle({
      width: '16px',
      height: '16px'
    })
  })

  it('gives docked mini apps the shared icon-row button sizing and hover styles', () => {
    const { container } = render(
      <Sidebar
        width={SIDEBAR_ICON_WIDTH}
        setWidth={vi.fn()}
        active={{ activeItem: 'chat' }}
        entries={[
          ...entries,
          miniEntry({
            title: 'Qwen',
            miniApp: { id: 'qwen', logo: 'qwen' }
          })
        ]}
      />
    )

    const miniAppLogo = container.querySelector('[data-testid="resolved-mini-app-logo"]')
    const dockedMiniAppButton = miniAppLogo?.closest('button')

    expect(miniAppLogo).toHaveStyle({ width: '22px', height: '22px' })
    expect(dockedMiniAppButton).toHaveClass('h-8', 'w-8')
    expect(dockedMiniAppButton).toHaveClass('text-sidebar-foreground', 'hover:bg-accent/60')
  })

  it('names icon-only docked mini app buttons from the full title when the logo is missing', () => {
    render(
      <Sidebar
        width={SIDEBAR_ICON_WIDTH}
        setWidth={vi.fn()}
        active={{ activeItem: 'chat' }}
        entries={[
          ...entries,
          miniEntry({
            title: 'Custom Tool',
            miniApp: { id: 'custom' }
          })
        ]}
      />
    )

    expect(screen.getByRole('button', { name: 'Custom Tool' })).toBeInTheDocument()
  })

  it('wires context menu actions for docked mini app icons', () => {
    const onRemove = vi.fn()

    render(
      <Sidebar
        width={SIDEBAR_ICON_WIDTH}
        setWidth={vi.fn()}
        active={{ activeItem: 'chat' }}
        entries={[
          ...entries,
          miniEntry(
            {
              title: 'Qwen',
              miniApp: { id: 'qwen', logo: 'qwen' }
            },
            [{ type: 'item', id: 'remove-qwen', label: 'Remove from Sidebar', onSelect: onRemove }]
          )
        ]}
      />
    )

    fireEvent.click(screen.getByTestId('context-menu-remove-qwen'))

    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('suppresses only the dragged sidebar entry click after sorting settles', () => {
    const onChatOpen = vi.fn()
    const onAgentOpen = vi.fn()
    const sortableEntries: ResolvedSidebarEntry[] = [
      {
        key: 'app:chat',
        label: 'Chat',
        renderIcon: () => null,
        isActive: (active) => active.activeItem === 'chat',
        onOpen: onChatOpen
      },
      {
        key: 'app:agent',
        label: 'Agent',
        renderIcon: () => null,
        isActive: (active) => active.activeItem === 'agent',
        onOpen: onAgentOpen
      }
    ]

    render(
      <Sidebar
        width={SIDEBAR_FULL_THRESHOLD}
        setWidth={vi.fn()}
        active={{ activeItem: 'chat' }}
        entries={sortableEntries}
        onEntriesReorder={vi.fn()}
      />
    )

    const sortableCall = uiMocks.sortableCalls.at(-1)
    sortableCall.onDragStart({ active: { id: 'app:chat' } })
    sortableCall.onDragEnd()

    fireEvent.click(screen.getByRole('button', { name: 'Chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))

    expect(onChatOpen).not.toHaveBeenCalled()
    expect(onAgentOpen).toHaveBeenCalledTimes(1)
  })

  it('renders footer actions with the current sidebar layout', () => {
    const renderActions = (layout: 'icon' | 'full') => <button type="button">theme-{layout}</button>

    const { rerender } = render(
      <Sidebar
        width={SIDEBAR_ICON_WIDTH}
        setWidth={vi.fn()}
        active={{ activeItem: 'chat' }}
        entries={entries}
        actions={renderActions}
      />
    )

    expect(document.body).toHaveTextContent('theme-icon')

    rerender(
      <Sidebar
        width={SIDEBAR_FULL_THRESHOLD}
        setWidth={vi.fn()}
        active={{ activeItem: 'chat' }}
        entries={entries}
        actions={renderActions}
      />
    )

    expect(document.body).toHaveTextContent('theme-full')
    expect(document.body).not.toHaveTextContent('theme-icon')
  })

  it('uses the owner-scoped glass surface for the floating hidden-state panel', () => {
    const { container } = render(
      <Sidebar
        width={SIDEBAR_HIDDEN_THRESHOLD - 10}
        setWidth={vi.fn()}
        active={{ activeItem: 'chat' }}
        entries={entries}
        isFloating
      />
    )

    const panel = container.querySelector('.slide-in-from-left-2')

    expect(panel).toHaveClass('sidebar-theme', 'bg-[var(--sidebar-floating-bg)]', 'backdrop-blur-2xl')
    expect(panel).not.toHaveClass('bg-sidebar')
  })
})
