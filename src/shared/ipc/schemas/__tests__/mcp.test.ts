import { MAX_MCP_PACKAGE_BYTES } from '@shared/types/mcp'
import { describe, expect, it } from 'vitest'

import { mcpRequestSchemas } from '../mcp'

describe.each(['mcp.package.upload_dxt', 'mcp.package.upload_mcpb'] as const)('%s input', (route) => {
  const input = mcpRequestSchemas[route].input

  it('accepts a package at the byte limit', () => {
    expect(
      input.safeParse({
        buffer: new ArrayBuffer(MAX_MCP_PACKAGE_BYTES),
        fileName: `package.${route.endsWith('dxt') ? 'dxt' : 'mcpb'}`
      }).success
    ).toBe(true)
  })

  it('rejects empty and oversized packages before handler dispatch', () => {
    expect(input.safeParse({ buffer: new ArrayBuffer(0), fileName: 'empty' }).success).toBe(false)
    const result = input.safeParse({ buffer: new ArrayBuffer(MAX_MCP_PACKAGE_BYTES + 1), fileName: 'oversized' })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toContain(`${MAX_MCP_PACKAGE_BYTES}`)
  })
})
