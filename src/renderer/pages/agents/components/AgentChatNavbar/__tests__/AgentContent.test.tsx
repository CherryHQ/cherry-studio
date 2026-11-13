import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const preferenceMock = vi.hoisted(() => ({
  setShowSidebar: vi.fn(),
  showSidebar: false
}))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [preferenceMock.showSidebar, preferenceMock.setShowSidebar]
}))

vi.mock('@renderer/components/NavbarIcon', () => ({
  default: ({
    active,
    children,
    onClick,
    tone,
    ...props
  }: {
    active?: boolean
    children: ReactNode
    onClick?: () => void
    tone?: string
  }) => (
    <button type="button" data-active={active || undefined} data-tone={tone} onClick={onClick} {...props}>
      {children}
    </button>
  )
}))

vi.mock('../Tools', () => ({
  default: () => <span>tools</span>
}))

vi.mock('i18next', () => ({
  t: (key: string) => key
}))

import AgentContent from '../AgentContent'

const agentA = {
  id: 'agent-a',
  name: 'Agent A',
  model: 'provider::model-a',
  type: 'claude_code'
} as any

describe('AgentContent', () => {
  beforeEach(() => {
    preferenceMock.showSidebar = false
    preferenceMock.setShowSidebar.mockClear()
  })

  it('keeps the sidebar toggle inactive when the sidebar is visible', () => {
    preferenceMock.showSidebar = true

    render(<AgentContent activeAgent={agentA} />)

    const [toggle] = screen.getAllByRole('button')

    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows only the inactive sidebar toggle when the sidebar is hidden', () => {
    render(<AgentContent activeAgent={agentA} />)

    const toggle = screen.getAllByRole('button')[0]

    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })
})
