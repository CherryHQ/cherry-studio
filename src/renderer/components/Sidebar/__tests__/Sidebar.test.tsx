import { fireEvent, render } from '@testing-library/react'
import { Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { SIDEBAR_FULL_THRESHOLD, SIDEBAR_ICON_WIDTH, SIDEBAR_SNAP_THRESHOLD } from '../constants'
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

  it('snaps between icon and full after crossing the snap threshold', () => {
    expect(dragResizeFrom(50, SIDEBAR_SNAP_THRESHOLD)).toHaveBeenCalledWith(SIDEBAR_FULL_THRESHOLD)
    expect(dragResizeFrom(120, SIDEBAR_SNAP_THRESHOLD)).toHaveBeenCalledWith(SIDEBAR_ICON_WIDTH)
  })

  it('keeps the current snap target before the snap threshold is crossed', () => {
    const outwardDrag = dragResizeFrom(50, SIDEBAR_SNAP_THRESHOLD - 1)
    expect(outwardDrag).toHaveBeenCalledWith(SIDEBAR_ICON_WIDTH)
    expect(outwardDrag).not.toHaveBeenCalledWith(SIDEBAR_FULL_THRESHOLD)

    const inwardDrag = dragResizeFrom(120, SIDEBAR_SNAP_THRESHOLD + 1)
    expect(inwardDrag).toHaveBeenCalledWith(SIDEBAR_FULL_THRESHOLD)
    expect(inwardDrag).not.toHaveBeenCalledWith(SIDEBAR_ICON_WIDTH)
  })

  it('renders intermediate widths without menu text', () => {
    const { container, queryByText } = render(
      <Sidebar width={80} setWidth={vi.fn()} activeItem="chat" items={items} onItemClick={vi.fn()} />
    )

    expect(container.firstElementChild).toHaveStyle({ width: '80px' })
    expect(queryByText('Chat')).not.toBeInTheDocument()
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
