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

  it('tracks intermediate widths from the full-height edge handle', () => {
    const setWidth = vi.fn()
    const { container } = render(
      <Sidebar width={50} setWidth={setWidth} activeItem="chat" items={items} onItemClick={vi.fn()} />
    )
    const resizeHandle = container.querySelector('.cursor-col-resize') as HTMLElement

    fireEvent.mouseDown(resizeHandle, { clientX: 50 })
    fireEvent.mouseMove(document, { clientX: 80 })
    fireEvent.mouseUp(document)

    expect(setWidth).toHaveBeenCalledWith(80)
  })

  it('snaps intermediate shrink drags to the snap threshold on release', () => {
    const setWidth = vi.fn()
    const { container } = render(
      <Sidebar width={170} setWidth={setWidth} activeItem="chat" items={items} onItemClick={vi.fn()} />
    )
    const resizeHandle = container.querySelector('.cursor-col-resize') as HTMLElement

    fireEvent.mouseDown(resizeHandle, { clientX: 170 })
    fireEvent.mouseMove(document, { clientX: 80 })
    fireEvent.mouseUp(document)

    expect(setWidth).toHaveBeenNthCalledWith(1, 80)
    expect(setWidth).toHaveBeenLastCalledWith(SIDEBAR_SNAP_THRESHOLD)
  })

  it('snaps intermediate growth drags to the full threshold on release', () => {
    const setWidth = vi.fn()
    const { container } = render(
      <Sidebar width={65} setWidth={setWidth} activeItem="chat" items={items} onItemClick={vi.fn()} />
    )
    const resizeHandle = container.querySelector('.cursor-col-resize') as HTMLElement

    fireEvent.mouseDown(resizeHandle, { clientX: 65 })
    fireEvent.mouseMove(document, { clientX: 80 })
    fireEvent.mouseUp(document)

    expect(setWidth).toHaveBeenNthCalledWith(1, 80)
    expect(setWidth).toHaveBeenLastCalledWith(SIDEBAR_FULL_THRESHOLD)
  })

  it('pins hidden-adjacent visible widths to the icon width while dragging', () => {
    const setWidth = vi.fn()
    const { container } = render(
      <Sidebar width={50} setWidth={setWidth} activeItem="chat" items={items} onItemClick={vi.fn()} />
    )
    const resizeHandle = container.querySelector('.cursor-col-resize') as HTMLElement

    fireEvent.mouseDown(resizeHandle, { clientX: 50 })
    fireEvent.mouseMove(document, { clientX: 30 })
    fireEvent.mouseUp(document)

    expect(setWidth).toHaveBeenCalledTimes(1)
    expect(setWidth).toHaveBeenLastCalledWith(SIDEBAR_ICON_WIDTH)
  })

  it('tracks widths between the icon width and snap threshold without release snapping', () => {
    const setWidth = vi.fn()
    const { container } = render(
      <Sidebar width={50} setWidth={setWidth} activeItem="chat" items={items} onItemClick={vi.fn()} />
    )
    const resizeHandle = container.querySelector('.cursor-col-resize') as HTMLElement

    fireEvent.mouseDown(resizeHandle, { clientX: 50 })
    fireEvent.mouseMove(document, { clientX: 60 })
    fireEvent.mouseUp(document)

    expect(setWidth).toHaveBeenCalledTimes(1)
    expect(setWidth).toHaveBeenLastCalledWith(60)
  })

  it('collapses below the hidden threshold without release snapping', () => {
    const setWidth = vi.fn()
    const { container } = render(
      <Sidebar width={50} setWidth={setWidth} activeItem="chat" items={items} onItemClick={vi.fn()} />
    )
    const resizeHandle = container.querySelector('.cursor-col-resize') as HTMLElement

    fireEvent.mouseDown(resizeHandle, { clientX: 50 })
    fireEvent.mouseMove(document, { clientX: 10 })
    fireEvent.mouseUp(document)

    expect(setWidth).toHaveBeenCalledTimes(1)
    expect(setWidth).toHaveBeenLastCalledWith(0)
  })

  it('renders hidden-adjacent visible widths at the icon width while keeping menu text hidden', () => {
    const { container, queryByText } = render(
      <Sidebar width={30} setWidth={vi.fn()} activeItem="chat" items={items} onItemClick={vi.fn()} />
    )

    expect(container.firstElementChild).toHaveStyle({ width: `${SIDEBAR_ICON_WIDTH}px` })
    expect(queryByText('Chat')).not.toBeInTheDocument()
  })

  it('renders widths between the icon width and snap threshold as-is while keeping menu text hidden', () => {
    const { container, queryByText } = render(
      <Sidebar width={60} setWidth={vi.fn()} activeItem="chat" items={items} onItemClick={vi.fn()} />
    )

    expect(container.firstElementChild).toHaveStyle({ width: '60px' })
    expect(queryByText('Chat')).not.toBeInTheDocument()
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
