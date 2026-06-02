import { fireEvent, render, screen } from '@testing-library/react'
import { Home } from 'lucide-react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Sidebar } from '../Sidebar'
import type { SidebarMenuItem, SidebarTab } from '../types'

vi.mock('@cherrystudio/ui', () => ({
  MenuItem: ({ active, className, icon, label, onClick }: any) => (
    <button className={className} data-active={active} type="button" onClick={onClick}>
      {icon}
      {label}
    </button>
  )
}))

vi.mock('@renderer/config/constant', () => ({ isMac: false }))
vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => false
}))

const miniApp = {
  id: 'mini-app-1',
  type: 'miniapp' as const,
  title: 'Mini App',
  miniApp: { id: 'mini-app' }
}

const items: SidebarMenuItem[] = [
  {
    id: 'home',
    label: 'Home',
    icon: Home,
    miniAppTabs: [miniApp]
  }
]

const dockedTabs: SidebarTab[] = [
  {
    id: 'docked-mini-app',
    type: 'miniapp',
    title: 'Docked App',
    miniApp: { id: 'docked' }
  }
]

function renderFloatingSidebar(overrides: Partial<ComponentProps<typeof Sidebar>> = {}) {
  const props: ComponentProps<typeof Sidebar> = {
    width: 200,
    setWidth: vi.fn(),
    activeItem: 'home',
    items,
    title: 'Cherry Studio',
    activeTabId: undefined,
    dockedTabs,
    isFloating: true,
    onItemClick: vi.fn(),
    onMiniAppTabClick: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides
  }

  render(<Sidebar {...props} />)

  return props
}

describe('Sidebar', () => {
  afterEach(() => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    vi.restoreAllMocks()
  })

  it('uses card background for the floating panel', () => {
    renderFloatingSidebar()

    expect(screen.getByText('Cherry Studio').closest('.fixed')).toHaveClass('bg-card')
    expect(screen.getByText('Cherry Studio').closest('.fixed')).not.toHaveClass('bg-sidebar/70')
  })

  it('uses exit animation while the floating panel is closing', () => {
    renderFloatingSidebar({ isFloatingClosing: true })

    expect(screen.getByText('Cherry Studio').closest('.fixed')).toHaveClass('animate-out', 'slide-out-to-left-2')
    expect(screen.getByText('Cherry Studio').closest('.fixed')).not.toHaveClass('animate-in', 'slide-in-from-left-2')
  })

  it('dismisses the floating panel after menu items are selected', () => {
    const props = renderFloatingSidebar()

    fireEvent.click(screen.getByRole('button', { name: /Home/ }))
    expect(props.onItemClick).toHaveBeenCalledWith('home')
    expect(props.onDismiss).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /Mini App/ }))
    expect(props.onMiniAppTabClick).toHaveBeenCalledWith('mini-app-1')
    expect(props.onDismiss).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByText('Docked App').closest('div')!)
    expect(props.onMiniAppTabClick).toHaveBeenCalledWith('docked-mini-app')
    expect(props.onDismiss).toHaveBeenCalledTimes(3)
  })

  it('cleans the visible sidebar resize state on window blur', () => {
    const setWidth = vi.fn()
    const { container } = render(
      <Sidebar
        width={200}
        setWidth={setWidth}
        activeItem="home"
        items={items}
        title="Cherry Studio"
        dockedTabs={dockedTabs}
        onItemClick={vi.fn()}
      />
    )
    const resizeHandle = container.querySelector('.cursor-col-resize')

    if (!resizeHandle) {
      throw new Error('Expected sidebar resize handle')
    }

    fireEvent.mouseDown(resizeHandle, { clientX: 200 })
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')

    fireEvent.mouseMove(document, { clientX: 260 })
    expect(setWidth).toHaveBeenCalledTimes(1)

    fireEvent.blur(window)

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')

    fireEvent.mouseMove(document, { clientX: 320 })

    expect(setWidth).toHaveBeenCalledTimes(1)
  })
})
