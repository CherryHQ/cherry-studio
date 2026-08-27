import { describe, expect, it } from 'vitest'

import {
  buildClaudeMcpToolName,
  classifyClaudeTool,
  claudeToolApproval,
  type ClaudeToolDescriptor,
  matchesClaudeToolRule
} from '../toolRules'

const descriptor = (id: string, overrides: Partial<ClaudeToolDescriptor> = {}): ClaudeToolDescriptor => ({
  id,
  name: id,
  origin: 'builtin',
  ...overrides
})

describe('Claude Code tool rules', () => {
  const read = descriptor('Read')
  const edit = descriptor('Edit')
  const webSearch = descriptor('WebSearch')
  const mcpSearch = descriptor(buildClaudeMcpToolName('docs', 'search_docs'), {
    name: 'search_docs',
    origin: 'mcp',
    sourceId: 'server-1',
    sourceName: 'docs',
    sourceToolName: 'search_docs'
  })

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

  it('classifies runtime calls for the shared evaluator', () => {
    expect(classifyClaudeTool(read)).toBe('read')
    expect(classifyClaudeTool(edit)).toBe('edit')
    expect(classifyClaudeTool(descriptor('Bash'))).toBe('shell')
    expect(classifyClaudeTool(descriptor('AskUserQuestion'))).toBe('requires-user')
    expect(classifyClaudeTool(descriptor('Task'))).toBe('safe-first-party')
    expect(classifyClaudeTool(webSearch)).toBe('ordinary')
  })

  it('derives SDK catalog approvals without Bash prefix exceptions', () => {
    expect(claudeToolApproval({ ...read, sourceApproval: 'prompt' }, { permissionMode: 'full' }).approval).toBe('auto')
    expect(claudeToolApproval(webSearch, { permissionMode: 'full' }).approval).toBe('auto')
    expect(claudeToolApproval(edit, { permissionMode: 'edit' }).approval).toBe('auto')
    expect(claudeToolApproval(read, { permissionMode: 'default' }).approval).toBe('auto')
    expect(claudeToolApproval(webSearch, { permissionMode: 'default' }).approval).toBe('prompt')
    expect(claudeToolApproval(descriptor('Bash'), { permissionMode: 'edit' }).approval).toBe('prompt')
  })
})
