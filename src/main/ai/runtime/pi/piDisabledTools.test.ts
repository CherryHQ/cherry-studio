import { describe, expect, it } from 'vitest'

import { buildBuiltinMcpToolName } from '@shared/ai/builtinMcpToolName'
import { CLAUDE_TOOL_DEFS } from '@shared/ai/claudecode/toolRegistry'

import { expandPiMcpDisabledTools } from './piDisabledTools'
import { buildPiMcpToolName } from './piMcpExtension'

describe('built-in Pi MCP restrictions', () => {
  it('matches the production un-hashed names for every public built-in', () => {
    const tools = CLAUDE_TOOL_DEFS.filter((tool) => tool.exposure === 'user' && tool.mcpServer)
    expect(tools).toHaveLength(10)
    const names = new Set<string>()
    for (const tool of tools) {
      const serverName = tool.mcpServer!
      const toolName = tool.name.slice(`mcp__${serverName}__`.length)
      const name = buildBuiltinMcpToolName('pi', { serverName, toolName })
      names.add(name)
      expect(name.length).toBeLessThanOrEqual(64)
      expect(name).toBe(buildPiMcpToolName(serverName, toolName))
    }
    expect(names.size).toBe(10)
  })

  it.each(['pi', 'pi-durable'] as const)(
    'recognizes raw identities and keeps management independent for %s',
    (runtime) => {
      const search = expandPiMcpDisabledTools(new Set(['mcp__cherry-tools__kb_search']), runtime)
      expect(search.has('mcp__cherry_tools__kb_list')).toBe(true)
      expect(search.has('mcp__cherry_tools__kb_read')).toBe(true)
      expect(search.has('mcp__cherry_tools__kb_manage')).toBe(false)
      const manage = expandPiMcpDisabledTools(new Set(['mcp__cherry_tools__kb_manage', 'external-name']), runtime)
      expect([...manage]).toEqual(['mcp__cherry_tools__kb_manage', 'external-name'])
    }
  )
})
