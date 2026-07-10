// @vitest-environment jsdom
import { WindowFrameProvider } from '@renderer/components/chat/shell/WindowFrameContext'
import { useCommandHandler } from '@renderer/hooks/command'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/components/Navbar', () => ({
  NavbarHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: vi.fn()
}))

vi.mock('../AgentContent', () => ({
  default: () => null
}))

import AgentChatNavbar from '../AgentChatNavbar'

describe('AgentChatNavbar', () => {
  it('does not register global search in a detached window', () => {
    render(
      <WindowFrameProvider value={{ mode: 'window' }}>
        <AgentChatNavbar activeAgent={null} />
      </WindowFrameProvider>
    )

    expect(vi.mocked(useCommandHandler).mock.calls.some(([command]) => command === 'app.search')).toBe(false)
  })
})
