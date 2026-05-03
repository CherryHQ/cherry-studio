/**
 * RED tests for the permission rule string ↔ object parser.
 *
 * Grammar:
 *   <ToolDisplayName>(<ruleContent>)        // pattern with content
 *   <ToolDisplayName>                        // whole-tool match (no parens)
 *   mcp__<server>__<tool>                    // MCP exact tool
 *   mcp__<server>                            // MCP server-wide
 *
 * Display name → registry name is mapped:
 *   Bash  → shell__exec
 *   Read  → fs__read
 *   Edit  → fs__patch
 *   Find  → fs__find
 *   Grep  → fs__grep
 *   Web   → web__search
 *   Kb    → kb__search
 *   mcp__* → as-is (already registry name)
 *
 * Round-trip MUST hold: serialize(parse(s)) === s for any valid s.
 */

import { describe, expect, it } from 'vitest'

import { parsePermissionRuleString, serializePermissionRuleString } from '../parser'

function ok(s: string): { toolName: string; ruleContent?: string } {
  const r = parsePermissionRuleString(s)
  if (!r.ok) throw new Error(`expected parse success, got error: ${r.error}`)
  return r.value
}

function err(s: string): string {
  const r = parsePermissionRuleString(s)
  if (r.ok) throw new Error(`expected parse error, got: ${JSON.stringify(r.value)}`)
  return r.error
}

describe('parsePermissionRuleString — happy path', () => {
  it('parses Bash with content → shell__exec', () => {
    expect(ok('Bash(git status:*)')).toEqual({ toolName: 'shell__exec', ruleContent: 'git status:*' })
  })

  it('parses Edit with path glob → fs__patch', () => {
    expect(ok('Edit(/etc/**)')).toEqual({ toolName: 'fs__patch', ruleContent: '/etc/**' })
  })

  it('parses Read with path → fs__read', () => {
    expect(ok('Read(src/**/*.ts)')).toEqual({ toolName: 'fs__read', ruleContent: 'src/**/*.ts' })
  })

  it('parses Web with domain pattern → web__search', () => {
    expect(ok('Web(domain:github.com)')).toEqual({ toolName: 'web__search', ruleContent: 'domain:github.com' })
  })

  it('parses MCP whole-server pattern (no content)', () => {
    expect(ok('mcp__filesystem')).toEqual({ toolName: 'mcp__filesystem', ruleContent: undefined })
  })

  it('parses MCP exact tool pattern (no content)', () => {
    expect(ok('mcp__filesystem__read')).toEqual({ toolName: 'mcp__filesystem__read', ruleContent: undefined })
  })

  it('parses display-name without content (whole-tool)', () => {
    expect(ok('Bash')).toEqual({ toolName: 'shell__exec', ruleContent: undefined })
  })
})

describe('parsePermissionRuleString — edge cases', () => {
  it('preserves leading/trailing whitespace inside content', () => {
    // Bash semantics matter; ` git status` ≠ `git status`. Don't trim content.
    expect(ok('Bash( git status )')).toEqual({ toolName: 'shell__exec', ruleContent: ' git status ' })
  })

  it('preserves nested parens inside content', () => {
    // Subcommand patterns may contain parens.
    expect(ok('Bash(echo $(date))')).toEqual({ toolName: 'shell__exec', ruleContent: 'echo $(date)' })
  })

  it('preserves quotes / brackets / wildcards inside content', () => {
    expect(ok('Bash(rg "foo bar" *.ts)')).toEqual({ toolName: 'shell__exec', ruleContent: 'rg "foo bar" *.ts' })
  })

  it('treats long content (>500 chars) without truncation', () => {
    const long = 'x'.repeat(600)
    expect(ok(`Bash(${long})`)).toEqual({ toolName: 'shell__exec', ruleContent: long })
  })

  it('rejects empty content (Bash() should fail — use Bash for whole-tool)', () => {
    expect(err('Bash()')).toMatch(/empty/i)
  })

  it('display-name match is case-sensitive (bash ≠ Bash)', () => {
    // Lowercase 'bash' is not a recognized display alias.
    expect(err('bash(git status)')).toMatch(/unknown tool/i)
  })
})

describe('parsePermissionRuleString — error cases', () => {
  it('rejects empty string', () => {
    expect(err('')).toMatch(/empty/i)
  })

  it('rejects whitespace-only', () => {
    expect(err('   ')).toMatch(/empty/i)
  })

  it('rejects unmatched open paren', () => {
    expect(err('Bash(git status')).toMatch(/closing/i)
  })

  it('rejects content after closing paren', () => {
    expect(err('Bash(git status) extra')).toMatch(/trailing/i)
  })

  it('rejects unrecognized display name', () => {
    expect(err('UnknownTool(content)')).toMatch(/unknown tool/i)
  })

  it('rejects tool name with whitespace', () => {
    expect(err('Bash thing(content)')).toMatch(/whitespace|invalid/i)
  })

  it('rejects malformed mcp prefix', () => {
    // mcp__ alone is not a valid tool target.
    expect(err('mcp__')).toMatch(/mcp/i)
  })
})

describe('serializePermissionRuleString', () => {
  it('serializes registry name back to display name', () => {
    expect(serializePermissionRuleString({ toolName: 'shell__exec', ruleContent: 'git status' })).toBe(
      'Bash(git status)'
    )
  })

  it('serializes whole-tool (no content) without parens', () => {
    expect(serializePermissionRuleString({ toolName: 'shell__exec' })).toBe('Bash')
  })

  it('serializes mcp tool name as-is', () => {
    expect(serializePermissionRuleString({ toolName: 'mcp__server__tool', ruleContent: undefined })).toBe(
      'mcp__server__tool'
    )
  })

  it('serializes mcp server-wide as-is', () => {
    expect(serializePermissionRuleString({ toolName: 'mcp__server' })).toBe('mcp__server')
  })

  it('throws when toolName has no display alias and is not mcp__*', () => {
    expect(() => serializePermissionRuleString({ toolName: 'unmapped__tool', ruleContent: 'x' })).toThrow(
      /no display alias/i
    )
  })
})

describe('parsePermissionRuleString ↔ serializePermissionRuleString — round-trip', () => {
  const cases = [
    'Bash(git status)',
    'Bash(rg "foo bar" *.ts)',
    'Edit(/etc/**)',
    'Read(src/**/*.ts)',
    'Web(domain:github.com)',
    'Bash',
    'mcp__filesystem',
    'mcp__filesystem__read'
  ]
  it.each(cases)('round-trips %s', (s) => {
    expect(serializePermissionRuleString(ok(s))).toBe(s)
  })
})
