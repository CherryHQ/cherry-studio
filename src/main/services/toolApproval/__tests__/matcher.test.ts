/**
 * RED tests for the tool-agnostic rule matcher.
 *
 * `toolMatchesRule(toolName, input, rule, ctx, registry)` returns true iff:
 *   1. Tool name matches (exact, or `mcp__server` wildcard for `mcp__server__*`).
 *   2. If `rule.scope.cwd` is set, `ctx.cwd` must equal it.
 *   3. If `rule.ruleContent` is undefined → match (whole-tool).
 *      Else → delegate to per-tool ContentMatcher registered under that toolName.
 *      If no matcher registered → return false (fail-closed: can't verify).
 */

import { describe, expect, it, vi } from 'vitest'

import { createMatcherRegistry, toolMatchesRule } from '../matcher'
import { makeContext, makeRule } from './testUtils'

describe('toolMatchesRule — toolName matching', () => {
  it('exact match', () => {
    const reg = createMatcherRegistry()
    const rule = makeRule({ toolName: 'shell__exec' })
    expect(toolMatchesRule('shell__exec', {}, rule, makeContext(), reg)).toBe(true)
  })

  it('different tool name → no match', () => {
    const reg = createMatcherRegistry()
    const rule = makeRule({ toolName: 'shell__exec' })
    expect(toolMatchesRule('fs__read', {}, rule, makeContext(), reg)).toBe(false)
  })

  it('MCP server-wide rule matches any tool of that server', () => {
    const reg = createMatcherRegistry()
    const rule = makeRule({ toolName: 'mcp__filesystem' })
    expect(toolMatchesRule('mcp__filesystem__read', {}, rule, makeContext(), reg)).toBe(true)
    expect(toolMatchesRule('mcp__filesystem__write', {}, rule, makeContext(), reg)).toBe(true)
  })

  it('MCP server-wide rule does NOT match other server', () => {
    const reg = createMatcherRegistry()
    const rule = makeRule({ toolName: 'mcp__filesystem' })
    expect(toolMatchesRule('mcp__weather__forecast', {}, rule, makeContext(), reg)).toBe(false)
  })

  it('MCP exact tool rule does NOT match sibling tool', () => {
    const reg = createMatcherRegistry()
    const rule = makeRule({ toolName: 'mcp__filesystem__read' })
    expect(toolMatchesRule('mcp__filesystem__write', {}, rule, makeContext(), reg)).toBe(false)
  })
})

describe('toolMatchesRule — scope', () => {
  it('rule with scope.cwd matches when ctx.cwd equals', () => {
    const reg = createMatcherRegistry()
    const rule = makeRule({ scope: { cwd: '/Users/me/proj' } })
    expect(toolMatchesRule('shell__exec', {}, rule, makeContext({ cwd: '/Users/me/proj' }), reg)).toBe(true)
  })

  it('rule with scope.cwd does NOT match when ctx.cwd differs', () => {
    const reg = createMatcherRegistry()
    const rule = makeRule({ scope: { cwd: '/Users/me/proj' } })
    expect(toolMatchesRule('shell__exec', {}, rule, makeContext({ cwd: '/Users/me/other' }), reg)).toBe(false)
  })

  it('rule with scope.cwd does NOT match when ctx.cwd is missing', () => {
    const reg = createMatcherRegistry()
    const rule = makeRule({ scope: { cwd: '/Users/me/proj' } })
    expect(toolMatchesRule('shell__exec', {}, rule, makeContext({ cwd: undefined }), reg)).toBe(false)
  })

  it('rule without scope matches any cwd (global)', () => {
    const reg = createMatcherRegistry()
    const rule = makeRule({ scope: undefined })
    expect(toolMatchesRule('shell__exec', {}, rule, makeContext({ cwd: '/anywhere' }), reg)).toBe(true)
  })
})

describe('toolMatchesRule — ruleContent delegation', () => {
  it('undefined ruleContent → match (whole-tool)', () => {
    const reg = createMatcherRegistry()
    const rule = makeRule({ ruleContent: undefined })
    expect(toolMatchesRule('shell__exec', {}, rule, makeContext(), reg)).toBe(true)
  })

  it('ruleContent set + matcher returns true → match', () => {
    const reg = createMatcherRegistry()
    const matcher = vi.fn(() => true)
    reg.register('shell__exec', matcher)
    const rule = makeRule({ ruleContent: 'git status' })
    expect(toolMatchesRule('shell__exec', { command: 'git status' }, rule, makeContext(), reg)).toBe(true)
    expect(matcher).toHaveBeenCalledWith({ command: 'git status' }, 'git status', expect.anything())
  })

  it('ruleContent set + matcher returns false → no match', () => {
    const reg = createMatcherRegistry()
    reg.register('shell__exec', () => false)
    const rule = makeRule({ ruleContent: 'git status' })
    expect(toolMatchesRule('shell__exec', { command: 'rm -rf' }, rule, makeContext(), reg)).toBe(false)
  })

  it('ruleContent set + NO matcher registered → fail closed (no match)', () => {
    const reg = createMatcherRegistry()
    const rule = makeRule({ ruleContent: 'git status' })
    expect(toolMatchesRule('shell__exec', {}, rule, makeContext(), reg)).toBe(false)
  })

  it('different tool routes to its own matcher', () => {
    const reg = createMatcherRegistry()
    const shellMatcher = vi.fn(() => true)
    const fsMatcher = vi.fn(() => true)
    reg.register('shell__exec', shellMatcher)
    reg.register('fs__patch', fsMatcher)
    const rule = makeRule({ toolName: 'fs__patch', ruleContent: '/etc/**' })
    expect(toolMatchesRule('fs__patch', { path: '/etc/hosts' }, rule, makeContext(), reg)).toBe(true)
    expect(shellMatcher).not.toHaveBeenCalled()
    expect(fsMatcher).toHaveBeenCalledOnce()
  })
})
