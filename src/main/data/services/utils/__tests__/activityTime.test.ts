import { describe, expect, it } from 'vitest'

import { getMessageActivityTimestamp, resolveResponseTerminalAt } from '../activityTime'

describe('activityTime', () => {
  it('counts user creation and assistant creation/completion, but ignores structural roles', () => {
    expect(getMessageActivityTimestamp({ role: 'user', createdAt: 100 })).toBe(100)
    expect(getMessageActivityTimestamp({ role: 'assistant', createdAt: 100 })).toBe(100)
    expect(getMessageActivityTimestamp({ role: 'assistant', createdAt: 100, terminalAt: 250 })).toBe(250)
    expect(getMessageActivityTimestamp({ role: 'system', createdAt: 300 })).toBeNull()
    expect(getMessageActivityTimestamp({ role: 'root', createdAt: 400 })).toBeNull()
  })

  it('records only the first terminal transition of an assistant response', () => {
    expect(resolveResponseTerminalAt({ role: 'assistant', status: 'pending', timestamp: 100 })).toBeNull()
    expect(resolveResponseTerminalAt({ role: 'assistant', status: 'success', timestamp: 200 })).toBe(200)
    expect(
      resolveResponseTerminalAt({ existingTerminalAt: 200, role: 'assistant', status: 'error', timestamp: 300 })
    ).toBe(200)
    expect(resolveResponseTerminalAt({ role: 'user', status: 'success', timestamp: 400 })).toBeNull()
  })
})
