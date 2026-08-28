import { describe, expect, it, vi } from 'vitest'

import { buildClaudePermissionContext } from '../permissionContext'

describe('buildClaudePermissionContext', () => {
  const base = {
    mode: 'default' as const,
    roots: { workspace: '/workspace', agentData: '/agent-data' },
    isDisabled: vi.fn(() => false),
    builtinRole: undefined
  }

  it('preserves the three-state interaction facts for runtime-local guards', () => {
    const context = buildClaudePermissionContext({
      ...base,
      interaction: { currentTurn: 'none', userResponse: 'unavailable' },
      delegated: false
    })

    expect(context.turn).toBe('interactive')
    expect(context.responder).toBe('unavailable')
    expect(context.interaction).toEqual({ currentTurn: 'none', userResponse: 'unavailable' })
  })

  it('projects delegated calls to an unavailable headless interaction', () => {
    const context = buildClaudePermissionContext({
      ...base,
      interaction: { currentTurn: 'interactive', userResponse: 'stream' },
      delegated: true
    })

    expect(context).toMatchObject({
      turn: 'headless',
      responder: 'unavailable',
      delegated: true,
      interaction: { currentTurn: 'headless', userResponse: 'unavailable' }
    })
  })
})
