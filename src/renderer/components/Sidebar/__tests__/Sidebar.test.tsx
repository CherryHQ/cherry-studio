import { fireEvent, render } from '@testing-library/react'
import { Search } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  getSidebarDisplayWidth,
  normalizeSidebarWidth,
  SIDEBAR_FULL_THRESHOLD,
  SIDEBAR_HIDDEN_THRESHOLD,
  SIDEBAR_ICON_WIDTH,
  SIDEBAR_MAX_WIDTH
} from '../constants'
import { Sidebar } from '../Sidebar'
import type { SidebarMenuItem } from '../types'

vi.mock('../Tooltip', () => ({
  SidebarTooltip: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => false
}))

vi.mock('@renderer/config/miniApps', () => ({
  getMiniAppsLogo: (logo?: string) => {
    if (logo !== 'qwen') return undefined

    const QwenLogo = ({ style }: { style?: CSSProperties }) => (
      <svg data-testid="resolved-mini-app-logo" style={style} />
    )
    QwenLogo.Avatar = ({ size }: { size: number }) => (
      <span data-size={size} data-testid="resolved-mini-app-logo-avatar" />
    )
    return QwenLogo
  }
}))

const items: SidebarMenuItem[] = [
  {
    id: 'chat',
    label: 'Chat',
    icon: Search
  }
]

const INTERMEDIATE_WIDTH = SIDEBAR_ICON_WIDTH + 30

function dragResizeFrom(width: number, moves: number | number[]) {
  const setWidth = vi.fn()
  const onResizePreview = vi.fn()
  const onHoverChange = vi.fn()
  const { container, unmount } = render(
    <Sidebar
      width={width}
      setWidth={setWidth}
      activeItem="chat"
      items={items}
      onItemClick={vi.fn()}
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
      <Sidebar width={SIDEBAR_ICON_WIDTH} setWidth={vi.fn()} activeItem="chat" items={items} onItemClick={vi.fn()} />
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
      <Sidebar width={INTERMEDIATE_WIDTH} setWidth={vi.fn()} activeItem="chat" items={items} onItemClick={vi.fn()} />
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
        activeItem="chat"
        items={items}
        onItemClick={vi.fn()}
      />
    )

    const resizeHandle = container.querySelector('.cursor-col-resize') as HTMLElement
    const hotZone = resizeHandle.parentElement

    expect(resizeHandle).toHaveClass('h-full', 'w-full', 'cursor-col-resize')
    expect(hotZone).toHaveClass('absolute', 'inset-y-0', 'left-0', 'z-50', 'w-4')
    expect(hotZone).toHaveClass('[-webkit-app-region:no-drag]')
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
      <Sidebar
        width={SIDEBAR_FULL_THRESHOLD}
        setWidth={vi.fn()}
        activeItem="chat"
        items={items}
        onItemClick={vi.fn()}
      />
    )

    expect(container.firstElementChild).toHaveStyle({ width: `${SIDEBAR_FULL_THRESHOLD}px` })
    expect(getByText('Chat')).toBeInTheDocument()
  })

  it('renders full docked mini app icons directly without avatar chrome', () => {
    const { container, getByTestId } = render(
      <Sidebar
        width={SIDEBAR_FULL_THRESHOLD}
        setWidth={vi.fn()}
        activeItem="chat"
        items={items}
        dockedTabs={[
          {
            id: 'qwen',
            title: 'Qwen',
            type: 'miniapp',
            miniApp: { id: 'qwen', logo: 'qwen' }
          }
        ]}
        onItemClick={vi.fn()}
      />
    )

    expect(container.querySelector('[data-testid="resolved-mini-app-logo-avatar"]')).not.toBeInTheDocument()
    expect(getByTestId('resolved-mini-app-logo')).toHaveStyle({ width: '16px', height: '16px' })
  })

  it('uses the same full row sizing and hover styles for docked mini apps as sidebar menu items', () => {
    const { getByText } = render(
      <Sidebar
        width={SIDEBAR_FULL_THRESHOLD}
        setWidth={vi.fn()}
        activeItem="chat"
        items={items}
        dockedTabs={[
          {
            id: 'qwen',
            title: 'Qwen',
            type: 'miniapp',
            miniApp: { id: 'qwen', logo: 'qwen' }
          }
        ]}
        onItemClick={vi.fn()}
      />
    )

    const sidebarItem = getByText('Chat').closest('button')
    const dockedMiniApp = getByText('Qwen').closest('button')

    expect(dockedMiniApp?.className).toBe(sidebarItem?.className)
  })

  it('uses the same full active indicator for docked mini apps as sidebar menu items', () => {
    const { container } = render(
      <Sidebar
        width={SIDEBAR_FULL_THRESHOLD}
        setWidth={vi.fn()}
        activeItem="chat"
        activeTabId="qwen"
        items={items}
        dockedTabs={[
          {
            id: 'qwen',
            title: 'Qwen',
            type: 'miniapp',
            miniApp: { id: 'qwen', logo: 'qwen' }
          }
        ]}
        onItemClick={vi.fn()}
      />
    )

    expect(container.querySelector('.bg-sidebar-glow-bg')).not.toBeInTheDocument()
    expect(container.querySelector('.bg-sidebar-glow-line')).not.toBeInTheDocument()
  })

  it('uses the same icon row sizing and hover styles for docked mini apps as sidebar menu items', () => {
    const { getByTestId } = render(
      <Sidebar
        width={SIDEBAR_ICON_WIDTH}
        setWidth={vi.fn()}
        activeItem="chat"
        items={items}
        dockedTabs={[
          {
            id: 'qwen',
            title: 'Qwen',
            type: 'miniapp',
            miniApp: { id: 'qwen', logo: 'qwen' }
          }
        ]}
        onItemClick={vi.fn()}
      />
    )

    const dockedMiniAppButton = getByTestId('resolved-mini-app-logo').closest('button')

    expect(getByTestId('resolved-mini-app-logo')).toHaveStyle({ width: '22px', height: '22px' })
    expect(dockedMiniAppButton).toHaveClass('h-9', 'w-9')
    expect(dockedMiniAppButton).toHaveClass('hover:bg-accent/60', 'hover:text-foreground')
  })

  it('renders footer actions with the current sidebar layout', () => {
    const renderActions = (layout: 'icon' | 'full') => <button type="button">theme-{layout}</button>

    const { rerender } = render(
      <Sidebar
        width={SIDEBAR_ICON_WIDTH}
        setWidth={vi.fn()}
        activeItem="chat"
        items={items}
        actions={renderActions}
        onItemClick={vi.fn()}
      />
    )

    expect(document.body).toHaveTextContent('theme-icon')

    rerender(
      <Sidebar
        width={SIDEBAR_FULL_THRESHOLD}
        setWidth={vi.fn()}
        activeItem="chat"
        items={items}
        actions={renderActions}
        onItemClick={vi.fn()}
      />
    )

    expect(document.body).toHaveTextContent('theme-full')
    expect(document.body).not.toHaveTextContent('theme-icon')
  })

  it('uses a solid sidebar background for the floating hidden-state panel', () => {
    const { container } = render(
      <Sidebar
        width={SIDEBAR_HIDDEN_THRESHOLD - 10}
        setWidth={vi.fn()}
        activeItem="chat"
        items={items}
        isFloating
        onItemClick={vi.fn()}
      />
    )

    const panel = container.querySelector('.slide-in-from-left-2')

    expect(panel).toHaveClass('bg-sidebar')
    expect(panel).not.toHaveClass('bg-sidebar/70')
  })
})
