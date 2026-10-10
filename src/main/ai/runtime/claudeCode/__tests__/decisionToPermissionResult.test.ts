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

  it('attributes a reason the user supplied', () => {
    expect(
      decisionToPermissionResult({ approved: false, reason: 'use a copy instead', reasonSource: 'user' }, original)
    ).toEqual({
      behavior: 'deny',
      message:
        "The user doesn't want to proceed with this tool use. The tool use was rejected (it did not run). To tell you how to proceed, the user said:\nuse a copy instead"
    })
  })

  it('tells the model the tool did not run when the user denied without a reason', () => {
    expect(decisionToPermissionResult({ approved: false, reasonSource: 'user' }, original)).toEqual({
      behavior: 'deny',
      message:
        "The user doesn't want to proceed with this tool use. The tool use was rejected (it did not run). Wait for the user's instructions instead of retrying it."
    })
  })
})
