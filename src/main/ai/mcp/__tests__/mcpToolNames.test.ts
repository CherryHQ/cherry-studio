import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { planClaudeMcpToolNames, sanitizeClaudeMcpNameSegment } from '../mcpToolNames'

const serverId = '12345678-1234-4234-8234-123456789abc'
const identity = { serverId, sdkServerKey: serverId }

// These contracts catch provider rejection, irreversible aliases, and ambiguous dispatch.
describe('Claude MCP tool names', () => {
  it.each([20, 21, 22, 23])('bounds a UUID server with a %i-character tool', (length) => {
    const original = 't'.repeat(length)
    const plan = planClaudeMcpToolNames(identity, [original])
    expect(plan.serverKey).toBe(serverId)
    const alias = plan.toolName(original)
    expect(`mcp__${plan.serverKey}__${alias}`.length).toBeLessThanOrEqual(64)
    if (length <= 21) expect(alias).toBe(original)
    else {
      expect(alias).not.toBe(original)
      expect(alias.length).toBe(21)
      const digest = createHash('sha256').update(`${serverId}\0${original}`).digest('hex').slice(0, 12)
      expect(alias).toBe(`${original.slice(0, 8)}_${digest}`)
    }
    expect(plan.resolve(alias)).toEqual({ serverId, toolName: original })
    expect(plan.resolve('unknown')).toBeUndefined()
  })

  it.each([44, 45, 100])('uses a catalog-independent key at server length %i', (length) => {
    const key = 's'.repeat(length)
    const input = { serverId, sdkServerKey: key }
    const cold = planClaudeMcpToolNames(input, [])
    const warm = planClaudeMcpToolNames(input, ['short', 't'.repeat(100)])
    expect(cold.serverKey).toBe(warm.serverKey)
    expect(warm.serverKey).toBe(
      length <= 44 ? key : `s_${createHash('sha256').update(serverId).digest('hex').slice(0, 20)}`
    )
    expect(`mcp__${warm.serverKey}__${warm.toolName('t'.repeat(100))}`).toHaveLength(64)
    if (length > 44) expect(warm.toolName('short')).toBe('short')
  })

  it('keeps distinct long tools stable under catalog reordering and removal', () => {
    const tools = ['same_prefix_' + 'a'.repeat(40), 'same_prefix_' + 'b'.repeat(40)]
    const first = planClaudeMcpToolNames(identity, tools)
    const reordered = planClaudeMcpToolNames(identity, [...tools].reverse())
    expect(first.toolName(tools[0])).not.toBe(first.toolName(tools[1]))
    for (const original of tools) {
      expect(reordered.toolName(original)).toBe(first.toolName(original))
      expect(reordered.resolve(first.toolName(original))).toEqual({ serverId, toolName: original })
    }
    expect(planClaudeMcpToolNames(identity, []).resolve(first.toolName(tools[0]))).toBeUndefined()
  })

  it('fails closed on distinct originals with the same sanitized alias', () => {
    expect(() => planClaudeMcpToolNames(identity, ['a.b', 'a b'])).toThrow(/collision.*a.b.*a b/)
    expect(() => planClaudeMcpToolNames(identity, ['a.b', 'a.b'])).not.toThrow()
    const long = 'x'.repeat(60)
    const alias = planClaudeMcpToolNames(identity, []).toolName(long)
    expect(() => planClaudeMcpToolNames(identity, [long, alias])).toThrow(/collision/)
  })

  it('mirrors CLI sanitization without case conversion or collapsing underscores', () => {
    expect(sanitizeClaudeMcpNameSegment('AZaz09_- .:/中文😀')).toBe('AZaz09_-________')
    expect(planClaudeMcpToolNames({ serverId, sdkServerKey: 'My Server' }, []).serverKey).toBe('My_Server')
  })
})
