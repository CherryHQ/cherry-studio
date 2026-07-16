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

  it('denies with the supplied reason', () => {
    expect(decisionToPermissionResult({ approved: false, reason: 'nope' }, original)).toEqual({
      behavior: 'deny',
      message: 'nope'
    })
  })

  it('denies with a default message when none is supplied', () => {
    expect(decisionToPermissionResult({ approved: false }, original)).toEqual({
      behavior: 'deny',
      message: 'User denied permission for this tool'
    })
  })
})
