import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { LocalAcpTool } from '@shared/ai/localAgent'

import { AcpTool } from '../AcpTool'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function Tool({ tool }: { tool: LocalAcpTool }) {
  const item = AcpTool({ tool })
  return (
    <>
      {item.label}
      {item.children}
    </>
  )
}

describe('ACP tool details', () => {
  it('shows updated terminal output and retains it when the native terminal no longer exists', () => {
    const tool = {
      title: 'Run checks',
      kind: 'execute',
      content: [{ type: 'terminal', terminalId: 'term' }],
      terminals: { term: 'checking' }
    }
    const { rerender } = render(<Tool tool={tool} />)
    expect(screen.getByText('checking')).toBeInTheDocument()
    rerender(
      <Tool
        tool={{
          ...tool,
          status: 'completed',
          terminals: { term: 'checks passed' },
          terminalDetails: { term: { truncated: true, exitCode: 0 } }
        }}
      />
    )
    expect(screen.getByText('checks passed')).toBeInTheDocument()
    expect(screen.queryByText('checking')).not.toBeInTheDocument()
    expect(screen.getByText('error.truncatedBadge')).toBeInTheDocument()
    expect(screen.getByText('message.tools.sections.exitCode: 0')).toBeInTheDocument()
  })
  it('renders embedded tool resources instead of their JSON envelope', () => {
    render(
      <Tool
        tool={{
          title: 'Read report',
          content: [
            {
              type: 'content',
              content: {
                type: 'resource',
                resource: { uri: 'report://summary', text: 'Report body' }
              }
            }
          ]
        }}
      />
    )
    expect(screen.getByText('Report body')).toBeInTheDocument()
    expect(screen.getByText('report://summary')).toBeInTheDocument()
    expect(screen.queryByText('message.tools.sections.output')).not.toBeInTheDocument()
  })
})
