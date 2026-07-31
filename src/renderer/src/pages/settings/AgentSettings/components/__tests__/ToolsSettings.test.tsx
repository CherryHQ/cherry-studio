import type { GetAgentResponse, Tool } from '@renderer/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ToolsSettings from '../ToolsSettings'

vi.mock('@renderer/components/CollapsibleSearchBar', () => ({
  default: () => null
}))

vi.mock('@renderer/hooks/useMCPServers', () => ({
  useMCPServers: () => ({ mcpServers: [] })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      if (key === 'agent.tools.builtin.PowerShell.description') {
        return 'Executes translated PowerShell commands in your environment'
      }
      return options?.defaultValue ?? key
    }
  }),
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  }
}))

const createAgent = (tools: Tool[]): GetAgentResponse => ({
  id: 'agent-1',
  type: 'claude-code',
  model: 'claude-test',
  accessible_paths: [],
  tools,
  created_at: '2026-07-31T00:00:00.000Z',
  updated_at: '2026-07-31T00:00:00.000Z'
})

const update = vi.fn(async () => undefined)

describe('ToolsSettings', () => {
  it('uses the translated description for the PowerShell builtin tool', () => {
    render(
      <ToolsSettings
        agentBase={createAgent([
          {
            id: 'PowerShell',
            name: 'PowerShell',
            type: 'builtin',
            description: 'PowerShell SDK description'
          }
        ])}
        update={update}
      />
    )

    expect(screen.getByText('Executes translated PowerShell commands in your environment')).toBeInTheDocument()
    expect(screen.queryByText('PowerShell SDK description')).not.toBeInTheDocument()
  })

  it('falls back to SDK metadata for an unknown builtin tool description', () => {
    render(
      <ToolsSettings
        agentBase={createAgent([
          {
            id: 'FutureBuiltin',
            name: 'Future Builtin',
            type: 'builtin',
            description: 'Future builtin SDK description'
          }
        ])}
        update={update}
      />
    )

    expect(screen.getByText('Future builtin SDK description')).toBeInTheDocument()
  })
})
