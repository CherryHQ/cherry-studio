import type { GetAgentResponse, Tool } from '@renderer/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const createAgent = (tools: Tool[], allowedTools?: string[]): GetAgentResponse => ({
  id: 'agent-1',
  type: 'claude-code',
  model: 'claude-test',
  accessible_paths: [],
  tools,
  allowed_tools: allowedTools,
  created_at: '2026-07-31T00:00:00.000Z',
  updated_at: '2026-07-31T00:00:00.000Z'
})

const update = vi.fn(async () => undefined)

describe('ToolsSettings', () => {
  beforeEach(() => {
    update.mockClear()
  })

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

  it('preserves opaque PowerShell while removing other unavailable IDs when toggling a visible tool', async () => {
    render(
      <ToolsSettings
        agentBase={createAgent(
          [
            {
              id: 'VisibleTool',
              name: 'Visible Tool',
              type: 'builtin',
              requirePermissions: true
            }
          ],
          ['PowerShell', 'StaleTool']
        )}
        update={update}
      />
    )

    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Visible Tool' }))

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({
        id: 'agent-1',
        allowed_tools: ['PowerShell', 'VisibleTool']
      })
    })
  })
})
