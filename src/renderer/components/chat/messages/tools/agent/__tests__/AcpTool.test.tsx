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
    rerender(<Tool tool={{ ...tool, status: 'completed', terminals: { term: 'checks passed' } }} />)
    expect(screen.getByText('checks passed')).toBeInTheDocument()
    expect(screen.queryByText('checking')).not.toBeInTheDocument()
  })
})
