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
  sessionGranted: false,
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
  it('blocks disabled tools and SQLite writes in every mode', () => {
    expect(decide('x', { disabled: true }, 'bypassPermissions')).toBe('block')
    expect(decide('x', { sqliteGuard: 'protected' }, 'bypassPermissions')).toBe('block')
    expect(decide('x', {}, 'bypassPermissions')).toBe('allow')
    expect(decide('x', { nonBypassable: true }, 'bypassPermissions')).toBe('ask')
  })

  // Catches installs escaping approvals via auto mode, child bypass, or a missing responder.
  describe.each(['bash', 'powershell'])('global installs via %s', (tool) => {
    it.each(['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'] as const)(
      'uses the effective %s mode for every attendance',
      (mode) => {
        for (const attendance of ['stream', 'message', 'unavailable'] as const) {
          const result = decideApproval(
            gateCall(tool),
            host({ globalInstall: 'npm i -g x' }),
            mode,
            attendance,
            undefined
          )
          expect(result).toEqual(
            mode === 'plan'
              ? { kind: 'block', reason: PLAN_BLOCK }
              : mode === 'bypassPermissions'
                ? { kind: 'allow' }
                : attendance === 'unavailable'
                  ? { kind: 'block', reason: UNATTENDED }
                  : { kind: 'ask', presentation: attendance }
          )
        }
      }
    )

    it.each(['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'] as const)(
      'uses root fact %s over incidental child bypass',
      (globalInstallPermissionMode) => {
        for (const attendance of ['stream', 'message', 'unavailable'] as const) {
          const facts = host({ globalInstall: 'npm i -g x', globalInstallPermissionMode })
          const result = decideApproval(gateCall(tool), facts, 'bypassPermissions', attendance, undefined)
          expect(result).toEqual(
            globalInstallPermissionMode === 'plan'
              ? { kind: 'block', reason: PLAN_BLOCK }
              : globalInstallPermissionMode === 'bypassPermissions'
                ? { kind: 'allow' }
                : attendance === 'unavailable'
                  ? { kind: 'block', reason: UNATTENDED }
                  : { kind: 'ask', presentation: attendance }
          )
          expect(facts.approvalRequired).toBe(false)
        }
      }
    )

    it.each(['default', 'acceptEdits', 'auto'] as const)('does not auto-approve installs in %s', (mode) => {
      expect(
        decideApproval(
          gateCall(tool),
          host({ globalInstall: 'install', autoApproved: true }),
          mode,
          'stream',
          undefined
        )
      ).toEqual({ kind: 'ask', presentation: 'stream' })
    })

    it('preserves active plans and higher-authority blocks', () => {
      const facts = host({ globalInstall: 'install', globalInstallPermissionMode: 'bypassPermissions' })
      expect(decideApproval(gateCall(tool), facts, 'bypassPermissions', 'stream', { active: true, at: 1 })).toEqual({
        kind: 'block',
        reason: PLAN_BLOCK
      })
      expect(
        decideApproval(gateCall(tool), { ...facts, disabled: true }, 'bypassPermissions', 'stream', undefined)
      ).toEqual({ kind: 'block', reason: `Tool "${tool}" is disabled for this agent.` })
      expect(
        decideApproval(gateCall(tool), { ...facts, sqliteGuard: 'protected' }, 'bypassPermissions', 'stream', undefined)
      ).toEqual({ kind: 'block', reason: 'protected' })
      expect(
        decideApproval(gateCall(tool), { ...facts, nonBypassable: true }, 'bypassPermissions', 'unavailable', undefined)
      ).toEqual({
        kind: 'block',
        reason: 'This tool always requires user approval and cannot run unattended. Retry interactively.'
      })
    })

    it.each(['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'] as const)(
      'hard-blocks mise in %s',
      (mode) => {
        expect(
          decideApproval(
            gateCall(tool),
            host({ globalInstall: 'install', miseMutation: 'direct mise mutation (use cli_search / cli_install)' }),
            mode,
            'stream',
            undefined
          )
        ).toEqual({ kind: 'block', reason: 'Blocked: direct mise mutation (use cli_search / cli_install).' })
      }
    )
  })

  // Catches unattended delegation escaping Full Access, or interactive delegation bypassing an active plan.
  it('keeps delegation interactive and subject to the plan gate', () => {
    for (const mode of ['default', 'acceptEdits', 'auto', 'bypassPermissions', 'plan'] as const) {
      expect(decide('delegate', { delegation: 'unattended' }, mode)).toBe('block')
      expect(
        decideApproval(gateCall('delegate'), host({ delegation: 'interactive' }), mode, 'stream', {
          active: true,
          at: 1
        }).kind
      ).toBe('block')
    }
    expect(decide('delegate', { delegation: 'interactive' }, 'auto')).toBe('allow')
    expect(decide('delegate', { delegation: 'interactive' }, 'bypassPermissions')).toBe('allow')
    expect(decide('delegate', { delegation: 'interactive' }, 'default')).toBe('ask')
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

  // Catches a shell command running unattended: a destructive one, or the first one this session has not granted yet.
  it('asks in auto mode for a destructive shell command or an ungranted first shell call', () => {
    expect(decide('bash', { category: 'shell', destructive: true }, 'auto')).toBe('ask')
    expect(decide('bash', { category: 'shell' }, 'auto')).toBe('ask')
    expect(decide('bash', { category: 'shell', sessionGranted: true }, 'auto')).toBe('allow')
    expect(decide('bash', { category: 'shell', destructive: true, sessionGranted: true }, 'auto')).toBe('ask')
    expect(decide('bash', {}, 'auto')).toBe('allow')
  })

  // Catches the reported endpoint path: code execution must never run unattended, even after a shell grant.
  it('always asks for codemode, and blocks it when nobody can answer', () => {
    const codemode = { category: 'shell' as const, approvalRequired: true, sessionGranted: true }
    expect(decide('codemode', codemode, 'auto')).toBe('ask')
    expect(decide('codemode', codemode, 'default')).toBe('ask')
    expect(decide('codemode', codemode, 'auto', 'unavailable')).toBe('block')
    expect(decide('codemode', codemode, 'bypassPermissions')).toBe('allow')
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
