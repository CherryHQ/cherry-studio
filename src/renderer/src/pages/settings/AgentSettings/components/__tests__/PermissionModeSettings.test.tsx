import type { GetAgentResponse, Tool } from '@renderer/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PermissionModeSettings from '../PermissionModeSettings'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) => {
      if (typeof fallback === 'string') {
        return fallback
      }
      return fallback?.defaultValue ?? key
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
  allowed_tools: ['PowerShell', 'StaleTool'],
  configuration: { permission_mode: 'default', max_turns: 100, env_vars: {} },
  created_at: '2026-07-31T00:00:00.000Z',
  updated_at: '2026-07-31T00:00:00.000Z'
})

const update = vi.fn(async () => undefined)

describe('PermissionModeSettings', () => {
  beforeEach(() => {
    update.mockClear()
  })

  it('preserves opaque PowerShell while removing other unavailable IDs when changing modes', async () => {
    render(
      <PermissionModeSettings
        agentBase={createAgent([
          {
            id: 'VisibleTool',
            name: 'Visible Tool',
            type: 'builtin',
            requirePermissions: true
          }
        ])}
        update={update}
      />
    )

    fireEvent.click(screen.getByText('Full Auto Mode'))

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({
        id: 'agent-1',
        configuration: { permission_mode: 'bypassPermissions', max_turns: 100, env_vars: {} },
        allowed_tools: ['VisibleTool', 'PowerShell']
      })
    })
  })
})
