import type * as CherryUi from '@cherrystudio/ui'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const preferenceMock = vi.hoisted(() => ({
  setShowSidebar: vi.fn(),
  showSidebar: false
}))

vi.mock('@cherrystudio/ui', async () => {
  const actual = await vi.importActual<typeof CherryUi>('@cherrystudio/ui')
  return {
    ...actual,
    Tooltip: ({ children }: { children: ReactNode }) => children
  }
})

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [preferenceMock.showSidebar, preferenceMock.setShowSidebar]
}))

vi.mock('@renderer/components/app/Navbar', () => ({
  NavbarHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/Icons', () => ({
  SidebarCollapseIcon: () => <span data-testid="collapse-icon" />,
  SidebarExpandIcon: () => <span data-testid="expand-icon" />
}))

vi.mock('i18next', () => ({
  t: (key: string) => key
}))

import ChatNavbar from '../ChatNavbar'

describe('ChatNavbar', () => {
  beforeEach(() => {
    preferenceMock.showSidebar = false
    preferenceMock.setShowSidebar.mockClear()
  })

  it('uses the conversation style without active state when the sidebar is hidden', () => {
    render(<ChatNavbar />)

    const [toggle] = screen.getAllByRole('button')

    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).not.toHaveAttribute('data-active')
    expect(toggle).toHaveClass('hover:bg-accent/60')
  })

  it('offers a new-topic button next to the toggle when the sidebar is hidden', () => {
    render(<ChatNavbar />)

    expect(screen.getByRole('button', { name: 'chat.conversation.new' })).toBeInTheDocument()
  })

  it('hides the new-topic button when the sidebar is visible', () => {
    preferenceMock.showSidebar = true

    render(<ChatNavbar />)

    expect(screen.queryByRole('button', { name: 'chat.conversation.new' })).not.toBeInTheDocument()
  })

  it('keeps the sidebar toggle inactive when the sidebar is visible', () => {
    preferenceMock.showSidebar = true

    render(<ChatNavbar />)

    const [toggle] = screen.getAllByRole('button')

    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).not.toHaveAttribute('data-active')
    expect(toggle).not.toHaveClass('bg-secondary')
  })
})
