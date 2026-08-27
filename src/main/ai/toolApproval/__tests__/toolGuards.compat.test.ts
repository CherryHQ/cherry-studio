import { describe, expect, it, vi } from 'vitest'

const { loggerError } = vi.hoisted(() => ({ loggerError: vi.fn() }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: loggerError })
  }
}))

import { evaluateToolGuards, type ToolGuardContext, type ToolGuardRule } from '../toolGuards'

function makeContext(): ToolGuardContext {
  return {
    toolName: 'Bash',
    input: undefined,
    permissionMode: 'default',
    builtinRole: undefined,
    mountedServers: new Set(),
    pluginDirectories: new Map(),
    cwd: '/workspace',
    agentDataPath: '/agent-data',
    interaction: { currentTurn: 'interactive', userResponse: 'stream' },
    isDisabled: () => false
  }
}

describe('Main tool guard compatibility wrapper', () => {
  it('injects the Main logger when a guard condition throws', async () => {
    const rule: ToolGuardRule = {
      id: 'throws',
      bypassBehavior: 'enforce',
      match: {
        when: () => {
          throw new Error('detector exploded')
        }
      },
      effect: 'deny',
      reason: 'never'
    }

    await expect(evaluateToolGuards([rule], makeContext())).resolves.toBeUndefined()
    expect(loggerError).toHaveBeenCalledWith(
      'Guard condition threw — treating as no match',
      expect.objectContaining({ ruleId: 'throws', toolName: 'Bash' })
    )
  })
})
