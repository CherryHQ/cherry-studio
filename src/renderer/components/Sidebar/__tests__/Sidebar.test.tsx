import { fireEvent, render } from '@testing-library/react'
import { Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { SIDEBAR_ICON_WIDTH } from '../constants'
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

  it('snaps intermediate widths to the icon layout from the full-height edge handle', () => {
    const setWidth = vi.fn()
    const { container } = render(
      <Sidebar width={50} setWidth={setWidth} activeItem="chat" items={items} onItemClick={vi.fn()} />
    )
    const resizeHandle = container.querySelector('.cursor-col-resize') as HTMLElement

    fireEvent.mouseDown(resizeHandle, { clientX: 50 })
    fireEvent.mouseMove(document, { clientX: 80 })
    fireEvent.mouseUp(document)

    expect(setWidth).toHaveBeenCalledWith(SIDEBAR_ICON_WIDTH)
  })

  it('renders intermediate widths without menu text', () => {
    const { queryByText } = render(
      <Sidebar width={80} setWidth={vi.fn()} activeItem="chat" items={items} onItemClick={vi.fn()} />
    )

    expect(queryByText('Chat')).not.toBeInTheDocument()
  })
})
