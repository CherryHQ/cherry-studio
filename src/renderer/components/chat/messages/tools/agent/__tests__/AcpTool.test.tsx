import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LocalAcpToolSchema, type LocalAcpTool } from '@shared/ai/localAgent'

import { getAcpToolDisclosure } from '../AcpTool'
import { AgentToolCallCard } from '../AgentToolCallCard'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@cherrystudio/ui', () => vi.importActual('@cherrystudio/ui'))

function Tool({ tool }: { tool: LocalAcpTool }) {
  const item = getAcpToolDisclosure({ tool })
  return (
    <>
      {item.label}
      {item.children}
    </>
  )
}

describe('ACP tool details', () => {
  it.each(['command', 'CommandLine', 'cmd'])(
    'shows the command from %s and working directory before approval',
    (key) => {
      render(
        <Tool
          tool={{
            title: 'Run workspace check',
            kind: 'execute',
            rawInput: { [key]: 'git status --short', cwd: '/work/project' }
          }}
        />
      )
      expect(screen.getByText('message.tools.sections.command').parentElement).toHaveTextContent('git status --short')
      expect(screen.getByText('/work/project')).toBeInTheDocument()
    }
  )

  it('keeps the tool card usable when an incremental update supplies its native operation details', () => {
    const { rerender } = render(<AgentToolCallCard toolCallId="call-1" toolName="Tool" />)
    rerender(
      <AgentToolCallCard
        toolCallId="call-1"
        toolName="ACP: Read report"
        input={{ localAcpTool: { title: 'Read report', kind: 'read' } }}
      />
    )
    expect(screen.getByText('Read report')).toBeInTheDocument()
  })

  it('reads saved native names and nullable locations while showing the readable title', () => {
    const tool = LocalAcpToolSchema.parse(
      JSON.parse(
        JSON.stringify({
          name: 'read_file',
          title: 'Read report',
          locations: [
            { path: '/report.txt', line: null },
            { path: '/other.txt', line: 7 }
          ]
        })
      )
    )
    expect(tool.name).toBe('read_file')
    render(<Tool tool={tool} />)
    expect(screen.getByText('Read report')).toBeInTheDocument()
    expect(screen.queryByText('read_file')).not.toBeInTheDocument()
    expect(screen.getByText('/report.txt')).toBeInTheDocument()
    expect(screen.getByText(':7')).toBeInTheDocument()
    expect(screen.queryByText(':null')).not.toBeInTheDocument()
  })

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
