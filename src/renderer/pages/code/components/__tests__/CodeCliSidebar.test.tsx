import { CodeCli } from '@shared/types/codeCli'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { CodeCliSidebar, type CodeCliSidebarProps } from '../CodeCliSidebar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
  Scrollbar: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  )
}))

vi.mock('../CLIIcon', () => ({
  CLIIcon: ({ id }: { id: string }) => <span data-testid={`cli-icon-${id}`} />
}))

const tools = [
  { value: CodeCli.CLAUDE_CODE, label: 'Claude Code', icon: undefined },
  { value: CodeCli.OPENAI_CODEX, label: 'OpenAI Codex', icon: undefined }
] as const

function renderSidebar(statuses: CodeCliSidebarProps['statuses'] = {}) {
  render(
    <CodeCliSidebar
      tools={tools as unknown as CodeCliSidebarProps['tools']}
      selectedCliTool={CodeCli.CLAUDE_CODE}
      onSelectTool={vi.fn()}
      toMeta={(tool) => ({ id: tool.value, label: tool.label, icon: tool.icon })}
      statuses={{
        [CodeCli.CLAUDE_CODE]: { installed: false, canUpgrade: false },
        [CodeCli.OPENAI_CODEX]: { installed: true, current: '1.2.3', canUpgrade: false },
        ...statuses
      }}
      installingTools={new Set()}
      upgradingTools={new Set()}
    />
  )
}

describe('CodeCliSidebar', () => {
  it('uses the same vertical spacing as the provider list', () => {
    renderSidebar()

    expect(screen.getByRole('button', { name: /Claude Code/ }).parentElement).toHaveClass('space-y-2')
  })

  it('renders each CLI row horizontally with status on the right', () => {
    renderSidebar()

    const name = screen.getByText('Claude Code')
    const status = screen.getByText('code.not_installed')

    expect(
      screen.getByTestId(`cli-icon-${CodeCli.CLAUDE_CODE}`).compareDocumentPosition(name) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(name.parentElement).toContainElement(status)
    expect(name.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders installed versions with the brand color', () => {
    renderSidebar()

    expect(screen.getByText('v1.2.3')).toHaveClass('text-primary')
  })

  it('renders the latest version and upgrade icon when an update is available', () => {
    renderSidebar({
      [CodeCli.OPENAI_CODEX]: { installed: true, current: '1.2.3', latest: '1.3.0', canUpgrade: true }
    })

    expect(screen.getByText('v1.3.0')).toBeInTheDocument()
    expect(screen.getByText('v1.3.0').parentElement?.querySelector('svg')).toHaveClass('text-warning')
  })
})
