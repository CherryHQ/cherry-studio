import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({ default: { existsSync: vi.fn(() => false) } }))

import fs from 'node:fs'

import { resolveDisallowedTools } from '../toolConditions'

const existsSync = vi.mocked(fs.existsSync)

beforeEach(() => {
  existsSync.mockReset()
  existsSync.mockReturnValue(false)
})

describe('resolveDisallowedTools', () => {
  it('disables every disabled-exposure tool with no overrides or ctx', () => {
    const disallowed = new Set(resolveDisallowedTools({}))
    // Parity with the former GLOBALLY_DISALLOWED_TOOLS set.
    expect(disallowed.has('WebSearch')).toBe(true)
    expect(disallowed.has('WebFetch')).toBe(true)
    expect(disallowed.has('TodoWrite')).toBe(true)
    // Newly disabled per the registry classification.
    expect(disallowed.has('NotebookEdit')).toBe(true)
    expect(disallowed.has('REPL')).toBe(true)
    expect(disallowed.has('CronCreate')).toBe(true)
    expect(disallowed.has('Monitor')).toBe(true)
    // user / internal tools are not disabled by default.
    expect(disallowed.has('Bash')).toBe(false)
    expect(disallowed.has('Read')).toBe(false)
    expect(disallowed.has('Workflow')).toBe(false)
    expect(disallowed.has('Agent')).toBe(false)
  })

  it('disables a user tool and its dependents (BashOutput follows Bash)', () => {
    const disallowed = new Set(resolveDisallowedTools({ disabledTools: ['Bash'] }))
    expect(disallowed.has('Bash')).toBe(true)
    expect(disallowed.has('BashOutput')).toBe(true)
  })

  it('ignores a disabledTools entry for a non-user tool', () => {
    const base = new Set(resolveDisallowedTools({}))
    const withAgent = new Set(resolveDisallowedTools({ disabledTools: ['Agent'] }))
    expect(withAgent).toEqual(base)
  })

  it('passes external MCP disabled entries through to the SDK disallowedTools list', () => {
    const disallowed = new Set(
      resolveDisallowedTools({ disabledTools: ['mcp__docs__search_docs', 'mcp__docs__*', 'Agent'] })
    )

    expect(disallowed.has('mcp__docs__search_docs')).toBe(true)
    expect(disallowed.has('mcp__docs__*')).toBe(true)
    expect(disallowed.has('Agent')).toBe(false)
  })

  it('treats predicate-gated tools as enabled when no ctx is supplied', () => {
    const disallowed = new Set(resolveDisallowedTools({}))
    expect(disallowed.has('EnterWorktree')).toBe(false)
    expect(disallowed.has('mcp__claw__notify')).toBe(false)
  })

  it('disables worktree without .git and claw notify/config without channels', () => {
    existsSync.mockReturnValue(false) // no .git
    const disallowed = new Set(resolveDisallowedTools({}, { cwd: '/ws', channels: [] }))
    expect(disallowed.has('EnterWorktree')).toBe(true)
    expect(disallowed.has('ExitWorktree')).toBe(true)
    expect(disallowed.has('mcp__claw__notify')).toBe(true)
    expect(disallowed.has('mcp__claw__config')).toBe(true)
  })

  it('enables worktree with .git and claw notify/config with a channel', () => {
    existsSync.mockReturnValue(true) // .git present
    const disallowed = new Set(resolveDisallowedTools({}, { cwd: '/ws', channels: [{ id: 'c1' }] }))
    expect(disallowed.has('EnterWorktree')).toBe(false)
    expect(disallowed.has('ExitWorktree')).toBe(false)
    expect(disallowed.has('mcp__claw__notify')).toBe(false)
    expect(disallowed.has('mcp__claw__config')).toBe(false)
  })
})
