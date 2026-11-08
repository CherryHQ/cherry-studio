import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import { type AgentGroupActionContext, resolveAgentGroupActions } from '../agentGroupActions'

// Prevent hiding the batch action on regular Agents or exposing Agent archive on protected ones.
describe('Agent group archive actions', () => {
  it.each([false, true])('resolves archive actions with protected=%s', (deleteSessionsOnly) => {
    const context: AgentGroupActionContext = {
      agentId: 'agent-a',
      assistantIconType: 'emoji',
      deleteSessionsOnly,
      onArchiveSessions: vi.fn(),
      onDeleteAgent: vi.fn(),
      onEdit: vi.fn(),
      onSetAgentIconType: vi.fn(),
      onTogglePin: vi.fn(),
      onToggleSidebar: vi.fn(),
      pinned: false,
      sidebarPinned: false,
      t: ((key: string) => key) as TFunction
    }
    expect(
      resolveAgentGroupActions(context)
        .filter((action) => action.group === 'danger')
        .map((action) => action.id)
    ).toEqual(
      deleteSessionsOnly
        ? ['agent-group.archive-sessions']
        : ['agent-group.archive-sessions', 'agent-group.archive-agent']
    )
  })
})
