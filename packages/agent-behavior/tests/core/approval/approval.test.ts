import { describe, expect, it } from 'vitest'

import {
  answerVerdict,
  decideApproval,
  NOBODY_TO_APPROVE,
  PLAN_BLOCK,
  repeatBlock,
  UNATTENDED
} from '../../../src/core/approval/approval'
import type { GateCall, GateFacts } from '../../../src/core/facts'
import type { ApprovalHostFacts, PermissionMode } from '../../../src/core/hostFacts'
import { call, callTo, thread } from '../history'

const gateCall = (tool: string, args = {}, nested = false): GateCall => ({
  key: call('k'),
  thread: thread('t'),
  tool,
  args,
  nested
})
const host = (patch: Partial<ApprovalHostFacts> = {}): ApprovalHostFacts => ({
  category: 'other',
  disabled: false,
  autoApproved: false,
  approvalRequired: false,
  nonBypassable: false,
  withinAllowedRoots: true,
  destructive: false,
  ...patch
})
const decide = (
  tool: string,
  facts: Partial<ApprovalHostFacts>,
  mode: PermissionMode = 'default',
  attendance: 'stream' | 'message' | 'unavailable' = 'stream'
) => decideApproval(gateCall(tool), host(facts), mode, attendance, undefined).kind

describe('approval decisions (D34)', () => {
  // Catches full access lifting a block that holds in every mode (P1–P3), or a non-bypassable tool's approval.
  it('blocks disabled tools, SQLite writes and global installs in every mode', () => {
    expect(decide('x', { disabled: true }, 'bypassPermissions')).toBe('block')
    expect(decide('x', { sqliteGuard: 'protected' }, 'bypassPermissions')).toBe('block')
    expect(
      decideApproval(gateCall('bash'), host({ globalInstall: 'npm i -g x' }), 'bypassPermissions', 'stream', undefined)
    ).toMatchObject({
      kind: 'block',
      reason: expect.stringMatching(/^Blocked to avoid cross-agent dependency pollution: npm i -g x\./)
    })
    expect(decide('x', {}, 'bypassPermissions')).toBe('allow')
    expect(decide('x', { nonBypassable: true }, 'bypassPermissions')).toBe('ask')
  })

  // Catches a mode that auto-approves a path outside the allowed roots, or gates reads inside them.
  it('asks per permission mode and path containment', () => {
    expect(decide('read', { category: 'read' })).toBe('allow')
    expect(decide('read', { category: 'read', withinAllowedRoots: false })).toBe('ask')
    expect(decide('write', { category: 'edit' }, 'acceptEdits')).toBe('allow')
    expect(decide('write', { category: 'edit' }, 'default')).toBe('ask')
    expect(decide('mcp', {}, 'auto')).toBe('allow')
    expect(decide('vcc_recall', { category: 'meta' })).toBe('allow')
    expect(decide('x', { autoApproved: true, approvalRequired: true })).toBe('ask')
  })

  // Catches auto mode running a command the host flagged as destructive, or stopping every shell command (P7).
  it('asks in auto mode only for destructive shell commands', () => {
    expect(decide('bash', { destructive: true }, 'auto')).toBe('ask')
    expect(decide('bash', {}, 'auto')).toBe('allow')
  })

  // Catches an unattended run waiting forever for a person, and the host rewrite getting lost on an allowed call.
  it('blocks when nobody can answer and carries the rewritten arguments', () => {
    expect(decideApproval(gateCall('x'), host(), 'default', 'unavailable', undefined)).toEqual({
      kind: 'block',
      reason: UNATTENDED
    })
    expect(
      decideApproval(
        gateCall('x'),
        host({ autoApproved: true, rewrittenArgs: { c: 1 } }),
        'default',
        'stream',
        undefined
      )
    ).toEqual({
      kind: 'allow',
      args: { c: 1 }
    })
  })

  // Catches plan mode letting an edit through or asking for approval instead of steering to exit_plan_mode (D37).
  it('blocks edits and approval-bound calls in plan mode', () => {
    const plan = { active: true, at: 1 }
    expect(decideApproval(gateCall('write'), host({ category: 'edit' }), 'bypassPermissions', 'stream', plan)).toEqual({
      kind: 'block',
      reason: PLAN_BLOCK
    })
    expect(decideApproval(gateCall('x'), host(), 'default', 'stream', plan)).toEqual({
      kind: 'block',
      reason: PLAN_BLOCK
    })
    expect(decideApproval(gateCall('read'), host({ category: 'read' }), 'default', 'stream', plan).kind).toBe('allow')
  })

  // Catches plan mode honoured only through a `cherry.plan` record: in the host's `plan` permission mode with no record,
  // an auto-approved edit ran (D37, `planActive`).
  it('blocks edits in the plan permission mode without a plan record', () => {
    expect(
      decideApproval(gateCall('write'), host({ category: 'edit', autoApproved: true }), 'plan', 'stream', undefined)
    ).toEqual({ kind: 'block', reason: PLAN_BLOCK })
    expect(decideApproval(gateCall('read'), host({ category: 'read' }), 'plan', 'stream', undefined).kind).toBe('allow')
  })
})

describe('answers and repeats', () => {
  // Catches a denial without the person's words, edited arguments dropped, or an unanswerable approval running the call.
  it('maps answers to the call', () => {
    const denied = answerVerdict({ kind: 'denied', feedback: ' use tests ' }, undefined)
    expect(denied.block).toMatch(/the user said:\nuse tests$/)
    expect(answerVerdict({ kind: 'granted', args: { a: 2 } }, { a: 1 })).toEqual({ args: { a: 2 } })
    expect(answerVerdict({ kind: 'granted' }, { a: 1 })).toEqual({ args: { a: 1 } })
    expect(answerVerdict({ kind: 'unavailable' }, undefined)).toEqual({ block: NOBODY_TO_APPROVE })
  })

  // Catches the third identical call running, a different call in between not resetting the count, or nested calls counted.
  it('blocks the third identical call in a row within a goal round', () => {
    const same = callTo('read', { p: 1 })
    const facts = (window: GateFacts['callWindow'], extra: Partial<GateFacts> = {}): GateFacts => ({
      plan: undefined,
      goalRound: true,
      callWindow: window,
      ...extra
    })
    const read = gateCall('read', { p: 1 })
    expect(repeatBlock(read, facts([same, same, same]))).toMatch(/already been executed/)
    expect(repeatBlock(read, facts([same, same]))).toBeUndefined()
    expect(repeatBlock(read, facts([same, callTo('ls'), same, same]))).toBeUndefined()
    expect(repeatBlock(gateCall('read', { p: 1 }, true), facts([same, same, same]))).toBeUndefined()
    expect(repeatBlock(read, facts([same, same, same], { goalRound: false }))).toBeUndefined()
  })
})
