import { fireEvent, render } from '@testing-library/react'
import { Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  getSidebarDisplayWidth,
  normalizeSidebarWidth,
  SIDEBAR_FULL_THRESHOLD,
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

const items: SidebarMenuItem[] = [
  {
    id: 'chat',
    label: 'Chat',
    icon: Search
  }
]

function dragResizeFrom(width: number, clientX: number) {
  const setWidth = vi.fn()
  const onResizePreview = vi.fn()
  const { container, unmount } = render(
    <Sidebar
      width={width}
      setWidth={setWidth}
      activeItem="chat"
      items={items}
      onItemClick={vi.fn()}
      onResizePreview={onResizePreview}
    />
  )
  const resizeHandle = container.querySelector('.cursor-col-resize') as HTMLElement

  fireEvent.mouseDown(resizeHandle, { clientX: width })
  fireEvent.mouseMove(document, { clientX })
  fireEvent.mouseUp(document)
  unmount()

  return { setWidth, onResizePreview }
}

describe('Sidebar resize handle', () => {
  it('keeps the existing handle width and opts out of window drag regions', () => {
    const { container } = render(
      <Sidebar width={50} setWidth={vi.fn()} activeItem="chat" items={items} onItemClick={vi.fn()} />
    )

    const resizeHandle = container.querySelector('.cursor-col-resize')

    expect(resizeHandle).toBeInTheDocument()
    expect(resizeHandle).toHaveClass('w-0.75')
    expect(resizeHandle).toHaveClass('[-webkit-app-region:no-drag]')
  })

  it('previews intermediate widths and snaps release by drag direction', () => {
    const cases: Array<[number, number, number]> = [
      [50, 80, SIDEBAR_FULL_THRESHOLD],
      [120, 80, SIDEBAR_ICON_WIDTH],
      [170, 110, SIDEBAR_ICON_WIDTH]
    ]

    for (const [start, moveTo, released] of cases) {
      const { setWidth, onResizePreview } = dragResizeFrom(start, moveTo)

      expect(onResizePreview).toHaveBeenNthCalledWith(1, moveTo)
      expect(onResizePreview).toHaveBeenLastCalledWith(null)
      expect(setWidth).toHaveBeenCalledTimes(1)
      expect(setWidth).toHaveBeenLastCalledWith(released)
    }
  })

  it('keeps non-intermediate drag behavior', () => {
    const cases: Array<[number, number]> = [
      [10, 0],
      [30, SIDEBAR_ICON_WIDTH],
      [130, 130],
      [300, SIDEBAR_MAX_WIDTH]
    ]

    for (const [moveTo, expected] of cases) {
      const { setWidth } = dragResizeFrom(120, moveTo)

      expect(setWidth).toHaveBeenCalledTimes(1)
      expect(setWidth).toHaveBeenLastCalledWith(expected)
    }
  })

  it('renders intermediate widths with icon layout without menu text', () => {
    const { container, queryByText } = render(
      <Sidebar width={80} setWidth={vi.fn()} activeItem="chat" items={items} onItemClick={vi.fn()} />
    )

    expect(container.firstElementChild).toHaveStyle({ width: '80px' })
    expect(queryByText('Chat')).not.toBeInTheDocument()
  })

  it('resolves display widths for CSS variable consumers', () => {
    expect(SIDEBAR_FULL_THRESHOLD).toBe(120)
    expect(getSidebarDisplayWidth(30)).toBe(SIDEBAR_ICON_WIDTH)
    expect(getSidebarDisplayWidth(80)).toBe(80)
    expect(getSidebarDisplayWidth(120)).toBe(SIDEBAR_FULL_THRESHOLD)
  })

  it('normalizes persisted intermediate widths to icon width', () => {
    expect(normalizeSidebarWidth(50)).toBe(SIDEBAR_ICON_WIDTH)
    expect(normalizeSidebarWidth(80)).toBe(SIDEBAR_ICON_WIDTH)
    expect(normalizeSidebarWidth(120)).toBe(SIDEBAR_FULL_THRESHOLD)
  })

  it('keeps the hidden-state hot zone full height without moving the resize binding', () => {
    const { container } = render(
      <Sidebar width={10} setWidth={vi.fn()} activeItem="chat" items={items} onItemClick={vi.fn()} />
    )

    const resizeHandle = container.querySelector('.cursor-col-resize') as HTMLElement
    const hotZone = resizeHandle.parentElement

    expect(resizeHandle).toHaveClass('h-full', 'w-full', 'cursor-col-resize')
    expect(hotZone).toHaveClass('absolute', 'inset-y-0', 'left-0', 'z-50', 'w-4')
    expect(hotZone).toHaveClass('[-webkit-app-region:no-drag]')
  })

  it('renders the full layout at the full threshold', () => {
    const { container, getByText } = render(
      <Sidebar width={120} setWidth={vi.fn()} activeItem="chat" items={items} onItemClick={vi.fn()} />
    )

    expect(container.firstElementChild).toHaveStyle({ width: '120px' })
    expect(getByText('Chat')).toBeInTheDocument()
  })

  it('uses a solid sidebar background for the floating hidden-state panel', () => {
    const { container } = render(
      <Sidebar width={10} setWidth={vi.fn()} activeItem="chat" items={items} isFloating onItemClick={vi.fn()} />
    )

    const panel = container.querySelector('.slide-in-from-left-2')

    expect(panel).toHaveClass('bg-sidebar')
    expect(panel).not.toHaveClass('bg-sidebar/70')
  })
})
