import { describe, expect, it } from 'vitest'

import { type ClaudeToolDescriptor, resolveClaudeToolAccess, resolveClaudeToolInvocationAccess } from '../toolRules'

describe('Claude Code tool rules', () => {
  const read: ClaudeToolDescriptor = { id: 'Read', name: 'Read', origin: 'builtin' }
  const edit: ClaudeToolDescriptor = { id: 'Edit', name: 'Edit', origin: 'builtin' }
  const webSearch: ClaudeToolDescriptor = { id: 'WebSearch', name: 'WebSearch', origin: 'builtin' }

  it('lets source force-prompt override the safe default', () => {
    expect(resolveClaudeToolAccess({ ...read, sourceApproval: 'prompt' }, {}).approval).toBe('prompt')
  })

  it('applies bypass, mode, safe, and manual defaults in order', () => {
    expect(resolveClaudeToolAccess(webSearch, { permissionMode: 'bypassPermissions' }).approval).toBe('auto')
    expect(resolveClaudeToolAccess(edit, { permissionMode: 'acceptEdits' }).approval).toBe('auto')
    expect(resolveClaudeToolAccess(read, {}).approval).toBe('auto')
    expect(resolveClaudeToolAccess(webSearch, {}).approval).toBe('prompt')
  })

  it('applies invocation-level acceptEdits Bash defaults', () => {
    const bash: ClaudeToolDescriptor = { id: 'Bash', name: 'Bash', origin: 'builtin' }

    expect(
      resolveClaudeToolInvocationAccess(
        bash,
        { permissionMode: 'acceptEdits' },
        { toolName: 'Bash', input: { command: 'mkdir tmp' } }
      ).approval
    ).toBe('auto')
    expect(
      resolveClaudeToolInvocationAccess(
        bash,
        { permissionMode: 'acceptEdits' },
        { toolName: 'Bash', input: { command: 'curl example.com' } }
      ).approval
    ).toBe('prompt')
  })
})
