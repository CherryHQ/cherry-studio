/**
 * Shared fixtures for the permission system tests.
 *
 * PreferenceService is mocked globally via the unified system in
 * `tests/__mocks__/main/PreferenceService.ts` — seed rules with
 * `MockMainPreferenceServiceUtils.setPreferenceValue(...)` and reset in
 * `beforeEach`. Don't add ad-hoc preference mocks here.
 */

import { vi } from 'vitest'

import type { PermissionContext, PermissionDecision, PermissionRule } from '../types'

/** Build a `PermissionRule` with sensible defaults. Override any field. */
export function makeRule(overrides: Partial<PermissionRule> = {}): PermissionRule {
  return {
    id: `rule-${Math.random().toString(36).slice(2, 10)}`,
    toolName: 'shell__exec',
    behavior: 'allow',
    source: 'userPreference',
    createdAt: 1_700_000_000_000,
    ...overrides
  }
}

/** Build a `PermissionContext` with sensible defaults. */
export function makeContext(overrides: Partial<PermissionContext> = {}): PermissionContext {
  return {
    toolKind: 'builtin',
    sessionId: 'session-test',
    toolCallId: 'tc-test',
    abortSignal: new AbortController().signal,
    ...overrides
  }
}

/** Build a `PermissionDecision` with sensible defaults. */
export function makeDecision(overrides: Partial<PermissionDecision> = {}): PermissionDecision {
  return {
    behavior: 'passthrough',
    ...overrides
  }
}

/**
 * Build a fake `ToolEntry`-shaped object. `checkPermissions` can be either
 * a literal decision or an async function for branching tests.
 */
export function mockToolEntry(
  opts: {
    name?: string
    checkPermissions?: PermissionDecision | ((input: unknown) => Promise<PermissionDecision>)
    matchRuleContent?: (input: unknown, ruleContent: string) => boolean
  } = {}
) {
  const name = opts.name ?? 'mock__tool'
  return {
    name,
    namespace: 'fs',
    description: 'mock',
    defer: 'never',
    capability: 'compute',
    tool: {
      description: 'mock',
      inputSchema: {},
      execute: vi.fn()
    },
    checkPermissions:
      typeof opts.checkPermissions === 'function'
        ? opts.checkPermissions
        : opts.checkPermissions !== undefined
          ? async () => opts.checkPermissions as PermissionDecision
          : undefined,
    matchRuleContent: opts.matchRuleContent
  }
}
