import { describe, expect, it } from 'vitest'

import {
  formatMcpRuntimeName,
  formatMcpServerWireName,
  formatMcpToolWireName,
  MCP_RUNTIME_NAME_MAX_LENGTH,
  MCP_SERVER_WIRE_NAME_MAX_LENGTH,
  MCP_TOOL_WIRE_NAME_MAX_LENGTH
} from '../mcpToolIdentity'

describe('MCP identity formatting', () => {
  it('formats bounded provider-safe server, tool, and runtime names', () => {
    const serverWireName = formatMcpServerWireName('server123', '0123456789ab')
    const toolWireName = formatMcpToolWireName('tool', 'fedcba987654')
    const runtimeName = formatMcpRuntimeName(serverWireName, toolWireName)

    expect(serverWireName).toHaveLength(MCP_SERVER_WIRE_NAME_MAX_LENGTH)
    expect(toolWireName).toHaveLength('tool__fedcba987654'.length)
    expect(toolWireName.length).toBeLessThanOrEqual(MCP_TOOL_WIRE_NAME_MAX_LENGTH)
    expect(runtimeName).toBe('mcp__server12_0123456789ab__tool__fedcba987654')
    expect(runtimeName.length).toBeLessThanOrEqual(MCP_RUNTIME_NAME_MAX_LENGTH)
  })

  it('uses fallbacks for names that have no readable slug', () => {
    expect(formatMcpServerWireName('', '0123456789ab')).toBe('server_0123456789ab')
    expect(formatMcpToolWireName('', 'fedcba987654')).toBe('tool__fedcba987654')
  })

  it('rejects malformed or over-budget preformatted values', () => {
    expect(() => formatMcpServerWireName('bad-name', '0123456789ab')).toThrow()
    expect(() => formatMcpRuntimeName('server_0123456789ab', 'tool__bad-digest')).toThrow()
    expect(() => formatMcpRuntimeName('s'.repeat(22), 'tool__fedcba987654')).toThrow()
  })
})
