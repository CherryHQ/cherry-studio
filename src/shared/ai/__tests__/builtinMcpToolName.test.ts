import { describe, expect, it } from 'vitest'

import { buildBuiltinMcpToolName } from '../builtinMcpToolName'

describe('buildBuiltinMcpToolName', () => {
  it.each([
    ['claude-code', 'mcp__cherry-tools__generate_image', 'mcp__agent-memory__memory'],
    ['pi', 'mcp__cherry_tools__generate_image', 'mcp__agent_memory__memory'],
    ['pi-durable', 'mcp__cherry_tools__generate_image', 'mcp__agent_memory__memory']
  ] as const)('builds renderer-safe identities for %s', (runtime, image, memory) => {
    expect(buildBuiltinMcpToolName(runtime, { serverName: 'cherry-tools', toolName: 'generate_image' })).toBe(image)
    expect(buildBuiltinMcpToolName(runtime, { serverName: 'agent-memory', toolName: 'memory' })).toBe(memory)
  })
})
