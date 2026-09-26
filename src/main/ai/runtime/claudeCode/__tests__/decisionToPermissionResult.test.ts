import { describe, expect, it } from 'vitest'

import { decisionToPermissionResult } from '../ToolApprovalRegistry'

describe('decisionToPermissionResult — DispatchDecision → Claude PermissionResult', () => {
  const original = { cmd: 'ls' }

  it('allows with the original input when no edit is supplied', () => {
    expect(decisionToPermissionResult({ approved: true }, original)).toEqual({
      behavior: 'allow',
      updatedInput: original
    })
  })

  it('allows with the edited input when provided', () => {
    expect(decisionToPermissionResult({ approved: true, updatedInput: { cmd: 'pwd' } }, original)).toEqual({
      behavior: 'allow',
      updatedInput: { cmd: 'pwd' }
    })
  })

  it('identifies the user and preserves quoted, multiline words in the model message', () => {
    expect(
      decisionToPermissionResult({ approved: false, source: 'user', reason: '  say "stop"\nfirst  ' }, original, 'Bash')
    ).toEqual({
      behavior: 'deny',
      message:
        'The user denied permission to use Bash. The tool did not execute. The user\'s exact words are between these markers:\n<<<USER_WORDS>>>\n  say "stop"\nfirst  \n<<<USER_WORDS>>>'
    })
  })

  it('uses the fixed no-reason message', () => {
    expect(decisionToPermissionResult({ approved: false, source: 'user' }, original, 'Bash')).toEqual({
      behavior: 'deny',
      message:
        'The user denied permission to use this tool. The tool did not execute. The user gave no reason and is waiting for your instructions.'
    })
  })

  it('preserves host reasons without attributing them to the user', () => {
    expect(
      decisionToPermissionResult({ approved: false, source: 'host', hostReason: 'aborted' }, original, 'Bash')
    ).toEqual({
      behavior: 'deny',
      message: 'aborted'
    })
  })
})
