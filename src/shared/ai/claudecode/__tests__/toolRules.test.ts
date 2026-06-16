import { describe, expect, it } from 'vitest'

import {
  buildClaudeMcpToolName,
  type ClaudeToolDescriptor,
  matchesClaudeToolRule,
  resolveClaudeToolAccess,
  resolveClaudeToolInvocationAccess
} from '../toolRules'

describe('Claude Code tool rules', () => {
  const read: ClaudeToolDescriptor = {
    id: 'Read',
    name: 'Read',
    origin: 'builtin'
  }

  const edit: ClaudeToolDescriptor = {
    id: 'Edit',
    name: 'Edit',
    origin: 'builtin'
  }

  const webSearch: ClaudeToolDescriptor = {
    id: 'WebSearch',
    name: 'WebSearch',
    origin: 'builtin'
  }

  const mcpSearch: ClaudeToolDescriptor = {
    id: buildClaudeMcpToolName('docs', 'search_docs'),
    name: 'search_docs',
    origin: 'mcp',
    sourceId: 'server-1',
    sourceName: 'docs',
    sourceToolName: 'search_docs'
  }

  it('matches Claude native builtin rules', () => {
    expect(matchesClaudeToolRule('Read', read)).toBe(true)
    expect(matchesClaudeToolRule('builtin_Read', read)).toBe(true)
  })

  it('matches Claude MCP runtime rules', () => {
    expect(matchesClaudeToolRule('mcp__docs__searchDocs', mcpSearch)).toBe(true)
    expect(matchesClaudeToolRule('mcp__docs__search_docs', mcpSearch)).toBe(true)
    expect(matchesClaudeToolRule('mcp__docs__*', mcpSearch)).toBe(true)
    expect(matchesClaudeToolRule('search_docs', mcpSearch)).toBe(false)
    expect(matchesClaudeToolRule('mcp__other__searchDocs', mcpSearch)).toBe(false)
  })

  it('lets source force-prompt override mode defaults', () => {
    expect(
      resolveClaudeToolAccess({ ...read, sourceApproval: 'prompt' }, { permissionMode: 'bypassPermissions' }).approval
    ).toBe('prompt')
  })

  it('applies mode, safe, and manual defaults in order', () => {
    expect(resolveClaudeToolAccess(webSearch, { permissionMode: 'bypassPermissions' }).approval).toBe('auto')
    expect(resolveClaudeToolAccess(edit, { permissionMode: 'acceptEdits' }).approval).toBe('auto')
    expect(resolveClaudeToolAccess(read, {}).approval).toBe('auto')
    expect(resolveClaudeToolAccess(webSearch, {}).approval).toBe('prompt')
  })

  it('applies invocation-level acceptEdits Bash defaults', () => {
    const bash: ClaudeToolDescriptor = {
      id: 'Bash',
      name: 'Bash',
      origin: 'builtin'
    }

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
