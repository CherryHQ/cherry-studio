// @vitest-environment jsdom
import { WindowFrameProvider } from '@renderer/components/chat/shell/WindowFrameContext'
import { useCommandHandler } from '@renderer/hooks/command'
import { render } from '@testing-library/react'
import type { HTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/components/Navbar', () => ({
  NavbarHeader: ({ children, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) => (
    <div {...props}>{children}</div>
  )
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: vi.fn()
}))

vi.mock('../AgentContent', () => ({
  default: () => null
}))

import AgentChatNavbar from '../AgentChatNavbar'

describe('AgentChatNavbar', () => {
  it('matches the assistant navbar layout contract', () => {
    const { container } = render(<AgentChatNavbar activeAgent={null} />)
    const navbar = container.querySelector<HTMLElement>('.agent-navbar')
    const content = navbar?.firstElementChild

    expect(navbar).toHaveStyle({ height: 'var(--navbar-height)' })
    expect(navbar).not.toHaveClass('bg-card', 'bg-background', 'h-(--navbar-height)')
    expect(content).toHaveClass('items-center', 'justify-between', 'overflow-hidden')
    expect(content).not.toHaveClass('shrink', 'overflow-auto')
  })

  it('does not register global search in a detached window', () => {
    render(
      <WindowFrameProvider value={{ mode: 'window' }}>
        <AgentChatNavbar activeAgent={null} />
      </WindowFrameProvider>
    )

    expect(vi.mocked(useCommandHandler).mock.calls.some(([command]) => command === 'app.search')).toBe(false)
  })
})
