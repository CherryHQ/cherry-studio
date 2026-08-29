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

vi.mock('@renderer/components/Navbar', () => ({
  NavbarHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/icons/SidebarToggleIcons', () => ({
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

  it('reflects sidebar visibility through the toggle state', () => {
    const { rerender } = render(<ChatNavbar />)

    expect(screen.getByRole('button', { name: 'navbar.show_sidebar' })).toHaveAttribute('aria-pressed', 'false')

    preferenceMock.showSidebar = true
    rerender(<ChatNavbar />)

    expect(screen.getByRole('button', { name: 'navbar.hide_sidebar' })).toHaveAttribute('aria-pressed', 'true')
  })

  it.each([false, true])('does not render a new-topic button when sidebar visibility is %j', (showSidebar) => {
    preferenceMock.showSidebar = showSidebar

    render(<ChatNavbar />)
    expect(screen.queryByRole('button', { name: 'chat.conversation.new' })).not.toBeInTheDocument()
  })

  it('places the conversation controls host after the sidebar toggle', () => {
    const { container } = render(<ChatNavbar />)

    const toggle = screen.getByRole('button', { name: 'navbar.show_sidebar' })
    const controls = container.querySelector('[data-conversation-topbar-controls]')

    expect(toggle.compareDocumentPosition(controls!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('places the title and branch switcher before the conversation controls', () => {
    const { container } = render(
      <ChatNavbar
        conversationTitle="A very long topic title"
        branchSwitcher={(title) => (
          <>
            {title}
            <button type="button">Main 4</button>
          </>
        )}
        conversationControls={<span>conversation metadata</span>}
      />
    )

    const title = screen.getByTestId('conversation-navbar-title')
    const branchSwitcher = screen.getByRole('button', { name: 'Main 4' })
    const controls = container.querySelector('[data-conversation-topbar-controls]')

    expect(title).toHaveTextContent('A very long topic title')
    expect(title).toHaveClass('truncate')
    // Layout contract: short titles use intrinsic width while long titles remain shrinkable.
    expect(title.parentElement).toHaveClass('w-fit', 'shrink')
    expect(title.parentElement).not.toHaveClass('flex-[1_1_8rem]')
    expect(title.compareDocumentPosition(branchSwitcher) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(branchSwitcher.compareDocumentPosition(controls!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
