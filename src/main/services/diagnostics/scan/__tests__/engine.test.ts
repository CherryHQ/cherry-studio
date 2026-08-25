import { describe, expect, it } from 'vitest'

import { buildScanReport, diagnose } from '../engine'
import { SCAN_RULES } from '../rules/registry'
import type { LogRecord, ScanRule } from '../types'

function rule(overrides: Partial<ScanRule> & Pick<ScanRule, 'id'>): ScanRule {
  return {
    domain: 'chat',
    attribution: 'transient',
    devMessage: 'test rule',
    anchors: [/boom/],
    ...overrides
  }
}

function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return { timestampMs: 1_000, level: 'error', message: 'boom', ...overrides }
}

describe('diagnose', () => {
  it('aggregates repeated matches into one finding with capped evidence', () => {
    const records = [1_000, 5_000, 3_000, 2_000, 4_000].map((timestampMs) => record({ timestampMs }))

    const findings = diagnose(records, { rules: [rule({ id: 'chat-repeat' })] })

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ ruleId: 'chat-repeat', count: 5, firstSeenMs: 1_000, lastSeenMs: 5_000 })
    expect(findings[0].evidence).toHaveLength(3)
    expect(findings[0].evidence.map((entry) => entry.timestampMs)).toEqual([1_000, 5_000, 3_000])
  })

  it('matches on stack and detail, not just the message', () => {
    const rules = [rule({ id: 'chat-anywhere', anchors: [/EFAKE/] })]

    expect(diagnose([record({ message: 'failed', stack: 'Error: EFAKE at x' })], { rules })).toHaveLength(1)
    expect(diagnose([record({ message: 'failed', detail: '{"code":"EFAKE"}' })], { rules })).toHaveLength(1)
    expect(diagnose([record({ message: 'failed' })], { rules })).toHaveLength(0)
  })

  it('applies the module gate only when the record carries a module', () => {
    const rules = [rule({ id: 'chat-gated', modules: ['Mcp'] })]

    expect(diagnose([record({ module: 'KnowledgeService' })], { rules })).toHaveLength(0)
    expect(diagnose([record({ module: 'Mcp:OAuthClientProvider' })], { rules })).toHaveLength(1)
    expect(diagnose([record({ module: 'Mcp' })], { rules })).toHaveLength(1)
    // pre-fix log lines have no module — the rule must degrade to its anchors
    expect(diagnose([record()], { rules })).toHaveLength(1)
    // prefix matching requires the namespace separator, not a bare startsWith
    expect(diagnose([record({ module: 'McpLikeButNot' })], { rules })).toHaveLength(0)
  })

  it('lets exclude veto an anchor match', () => {
    const rules = [rule({ id: 'chat-veto', exclude: [/harmless/] })]

    expect(diagnose([record({ message: 'boom but harmless' })], { rules })).toHaveLength(0)
    expect(diagnose([record({ message: 'boom for real' })], { rules })).toHaveLength(1)
  })

  it('matches warn and error by default but honors an explicit levels gate', () => {
    expect(diagnose([record({ level: 'warn' })], { rules: [rule({ id: 'chat-any-level' })] })).toHaveLength(1)

    const errorOnly = [rule({ id: 'chat-error-only', levels: ['error'] })]
    // both directions: a gate that rejected every level would still pass the negative case alone
    expect(diagnose([record({ level: 'error' })], { rules: errorOnly })).toHaveLength(1)
    expect(diagnose([record({ level: 'warn' })], { rules: errorOnly })).toHaveLength(0)
  })

  it('lets one record feed several rules and sorts findings by count then id', () => {
    const rules = [
      rule({ id: 'chat-b', anchors: [/boom/] }),
      rule({ id: 'chat-a', anchors: [/boom/] }),
      rule({ id: 'chat-frequent', anchors: [/other/] })
    ]
    const records = [record(), record({ message: 'other 1' }), record({ message: 'other 2' })]

    const findings = diagnose(records, { rules })

    expect(findings.map((finding) => finding.ruleId)).toEqual(['chat-frequent', 'chat-a', 'chat-b'])
  })

  it('returns an empty list for empty input', () => {
    expect(diagnose([], { rules: [rule({ id: 'chat-none' })] })).toEqual([])
  })
})

describe('buildScanReport', () => {
  const range = { fromMs: Date.parse('2026-08-20T00:00:00Z'), toMs: Date.parse('2026-08-21T00:00:00Z') }
  const stats = { scannedRecordCount: 1, unparsedLineCount: 0, skippedFileCount: 0, truncated: false }

  it('reports the rule count that was actually evaluated', () => {
    // a custom rule set must not be reported as if the whole shipped set had run
    expect(buildScanReport([], { range, ...stats, rulesEvaluated: 2 }).rulesEvaluated).toBe(2)
    expect(buildScanReport([], { range, ...stats }).rulesEvaluated).toBe(SCAN_RULES.length)
  })
})
