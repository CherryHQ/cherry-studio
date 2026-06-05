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
  const { container, unmount } = render(
    <Sidebar width={width} setWidth={setWidth} activeItem="chat" items={items} onItemClick={vi.fn()} />
  )
  const resizeHandle = container.querySelector('.cursor-col-resize') as HTMLElement

  fireEvent.mouseDown(resizeHandle, { clientX: width })
  fireEvent.mouseMove(document, { clientX })
  fireEvent.mouseUp(document)
  unmount()

  return setWidth
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

  it('switches state only when drag delta is greater than 15px', () => {
    const cases: Array<[number, number, number, number]> = [
      [80, 65, 65, SIDEBAR_ICON_WIDTH],
      [80, 66, 66, SIDEBAR_FULL_THRESHOLD],
      [120, 105, 105, SIDEBAR_FULL_THRESHOLD],
      [120, 104, 104, SIDEBAR_ICON_WIDTH],
      [170, 110, 110, SIDEBAR_ICON_WIDTH]
    ]

    for (const [start, moveTo, tracked, released] of cases) {
      const setWidth = dragResizeFrom(start, moveTo)

      expect(setWidth).toHaveBeenNthCalledWith(1, tracked)
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
      const setWidth = dragResizeFrom(120, moveTo)

      expect(setWidth).toHaveBeenCalledTimes(1)
      expect(setWidth).toHaveBeenLastCalledWith(expected)
    }
  })

  it('renders intermediate widths at icon width without menu text', () => {
    const { container, queryByText } = render(
      <Sidebar width={80} setWidth={vi.fn()} activeItem="chat" items={items} onItemClick={vi.fn()} />
    )

    expect(container.firstElementChild).toHaveStyle({ width: '50px' })
    expect(queryByText('Chat')).not.toBeInTheDocument()
  })

  it('resolves display widths for CSS variable consumers', () => {
    expect(SIDEBAR_FULL_THRESHOLD).toBe(120)
    expect(getSidebarDisplayWidth(30)).toBe(SIDEBAR_ICON_WIDTH)
    expect(getSidebarDisplayWidth(80)).toBe(SIDEBAR_ICON_WIDTH)
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
