import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { CodeCli } from '@shared/types/codeCli'

import { CodeCliSidebar, type CodeCliSidebarProps } from '../CodeCliSidebar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
  Scrollbar: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  )
}))

vi.mock('../CliIcon', () => ({
  CliIcon: ({ id }: { id: string }) => <span data-testid={`cli-icon-${id}`} />
}))

const tools = [
  { value: CodeCli.CLAUDE_CODE, label: 'Claude Code', icon: undefined },
  { value: CodeCli.OPENAI_CODEX, label: 'OpenAI Codex', icon: undefined }
] as const

function renderSidebar(
  statuses: CodeCliSidebarProps['statuses'] = {},
  providerSummaries: CodeCliSidebarProps['providerSummaries'] = {}
) {
  render(
    <CodeCliSidebar
      tools={tools as unknown as CodeCliSidebarProps['tools']}
      selectedCliTool={CodeCli.CLAUDE_CODE}
      onSelectTool={vi.fn()}
      toMeta={(tool) => ({ id: tool.value, label: tool.label, icon: tool.icon })}
      statuses={{
        [CodeCli.CLAUDE_CODE]: { installed: false, source: 'none', canUpgrade: false },
        [CodeCli.OPENAI_CODEX]: { installed: true, source: 'mise', current: '1.2.3', canUpgrade: false },
        ...statuses
      }}
      installingTools={new Set()}
      upgradingTools={new Set()}
      providerSummaries={providerSummaries}
    />
  )
}

describe('CodeCliSidebar', () => {
  it('renders no version or upgrade indicator for installed tools', () => {
    renderSidebar({
      [CodeCli.OPENAI_CODEX]: {
        installed: true,
        source: 'mise',
        current: '1.2.3',
        latest: '1.3.0',
        canUpgrade: true
      }
    })

    expect(screen.queryByText('v1.2.3')).not.toBeInTheDocument()
    expect(screen.queryByText('v1.3.0')).not.toBeInTheDocument()
  })

  it('renders the enabled-model label only on its matching tool', () => {
    renderSidebar({}, { [CodeCli.CLAUDE_CODE]: 'deepseek-v4-flash' })

    expect(screen.getByRole('button', { name: /Claude Code/ })).toHaveTextContent('deepseek-v4-flash')
    expect(screen.getByRole('button', { name: /OpenAI Codex/ }).textContent).not.toContain('deepseek-v4-flash')
  })
})
