import { describe, expect, it } from 'vitest'

import { buildMcpToolWireId } from '../mcpToolId'

describe('buildMcpToolWireId', () => {
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
