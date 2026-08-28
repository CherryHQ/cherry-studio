import { describe, expect, it } from 'vitest'

import {
  buildMcpServerWireName,
  buildMcpToolIdentityKey,
  buildMcpToolRuntimeName,
  buildMcpToolWireId,
  buildMcpToolWireName
} from '../mcpToolId'

describe('buildMcpToolWireId', () => {
  it('pins the 80-bit SHA-256 identity suffix', () => {
    expect(buildMcpToolWireId({ serverId: 'server-a', serverName: 'mysql', toolName: 'query' })).toBe(
      'mcp__mysql__query_306d76332fabbe783838'
    )
  })

  it('distinguishes identical display and tool names by server id', () => {
    const first = buildMcpToolWireId({ serverId: 'server-a', serverName: 'mysql', toolName: 'executeSql' })
    const second = buildMcpToolWireId({ serverId: 'server-b', serverName: 'mysql', toolName: 'executeSql' })

    expect(first).not.toBe(second)
  })

  it('distinguishes non-ASCII server names that share one readable slug', () => {
    const reimbursement = buildMcpToolWireId({
      serverId: 'server-a',
      serverName: 'mysql_报销',
      toolName: 'executeSql'
    })
    const elevator = buildMcpToolWireId({
      serverId: 'server-b',
      serverName: 'mysql_电梯',
      toolName: 'executeSql'
    })

    expect(reimbursement).not.toBe(elevator)
  })

  it('distinguishes non-ASCII tool names from one server', () => {
    const idCard = buildMcpToolWireId({ serverId: 'server-a', serverName: 'ocr', toolName: '识别身份证' })
    const invoice = buildMcpToolWireId({ serverId: 'server-a', serverName: 'ocr', toolName: '识别发票' })

    expect(idCard).not.toBe(invoice)
  })

  it('romanizes Chinese names so the readable slug survives', () => {
    const id = buildMcpToolWireId({ serverId: 'server-a', serverName: '票据 OCR', toolName: '识别发票' })

    expect(id).toMatch(/^mcp__piaoJuOcr__shiBieFaPiao_[0-9a-f]{20}$/)
  })

  it('leaves ASCII names untouched by romanization', () => {
    const id = buildMcpToolWireId({ serverId: 'server-a', serverName: 'MySQL', toolName: 'search_issues' })

    expect(id).toMatch(/^mcp__mysql__searchIssues_[0-9a-f]{20}$/)
  })

  it('is deterministic, identifier-safe, and at most 63 characters', () => {
    const input = { serverId: 'server-a', serverName: '数据库'.repeat(40), toolName: '123 查询'.repeat(40) }
    const first = buildMcpToolWireId(input)
    const second = buildMcpToolWireId(input)

    expect(first).toBe(second)
    expect(first).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
    expect(first.length).toBeLessThanOrEqual(63)
  })

  it('keeps the identity digest stable across server display-name changes', () => {
    const before = buildMcpToolWireId({ serverId: 'server-a', serverName: 'old-name', toolName: 'query' })
    const after = buildMcpToolWireId({ serverId: 'server-a', serverName: 'new-name', toolName: 'query' })

    expect(before).not.toBe(after)
    expect(before.slice(-20)).toBe(after.slice(-20))
  })
})

describe('canonical MCP identity and runtime names', () => {
  it('builds the full identity separately from the provider-visible name', () => {
    const serverWireName = buildMcpServerWireName({ serverId: 'server-a', serverName: 'mysql' })

    expect(buildMcpToolIdentityKey({ serverId: 'server-a', toolName: 'query' })).toBe(
      '306d76332fabbe783838cb296a98183cac2594360eb91e09cc525977115eb5ac'
    )
    expect(serverWireName).toBe('mysql_a79b8498a1fb')
    expect(buildMcpToolWireName({ serverId: 'server-a', toolName: 'query' })).toBe('query__306d76332fab')
    expect(buildMcpToolRuntimeName({ serverId: 'server-a', serverWireName, toolName: 'query' })).toBe(
      'mcp__mysql_a79b8498a1fb__query__306d76332fab'
    )
  })

  it('keeps a persisted server wire name stable when the display name changes', () => {
    const serverWireName = buildMcpServerWireName({ serverId: 'server-a', serverName: 'old-name' })

    expect(buildMcpToolRuntimeName({ serverId: 'server-a', serverWireName, toolName: 'query' })).toBe(
      'mcp__oldName_a79b8498a1fb__query__306d76332fab'
    )
    expect(buildMcpServerWireName({ serverId: 'server-a', serverName: 'new-name' })).not.toBe(serverWireName)
  })

  it('caps every readable part and the final runtime name at the provider budget', () => {
    const serverWireName = buildMcpServerWireName({ serverId: 'server-a', serverName: 's'.repeat(100) })
    const runtimeName = buildMcpToolRuntimeName({
      serverId: 'server-a',
      serverWireName,
      toolName: 'tool-name-'.repeat(100)
    })

    expect(serverWireName).toHaveLength(21)
    expect(runtimeName).toHaveLength(60)
    expect(runtimeName).toMatch(/^mcp__[a-zA-Z0-9_]+__[a-zA-Z0-9_]+__[0-9a-f]{12}$/)
  })

  it('keeps identical display names unique across server identities', () => {
    expect(buildMcpServerWireName({ serverId: 'server-a', serverName: 'mysql' })).not.toBe(
      buildMcpServerWireName({ serverId: 'server-b', serverName: 'mysql' })
    )
  })
})
