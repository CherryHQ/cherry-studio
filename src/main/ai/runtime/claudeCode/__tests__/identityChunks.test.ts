import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildIdentityDelivery,
  CLAUDE_HOOK_CONTEXT_MAX_UNITS,
  CLAUDE_IDENTITY_CHUNK_UNITS,
  CLAUDE_IDENTITY_HOOK_SLOTS,
  CLAUDE_IDENTITY_NOMINAL_CAPACITY_UNITS,
  splitIdentitySnapshot
} from '../identityChunks'

function unwrap(context: string) {
  const header =
    /^<agent_identity_part batch="batch" part="(\d+)\/(\d+)" units="(\d+)" truncated="(true|false)">\n/.exec(context)!
  expect(header).not.toBeNull()
  const start = context.indexOf('part is not a complete snapshot.\n') + 'part is not a complete snapshot.\n'.length
  const units = Number(header[3])
  return {
    part: Number(header[1]),
    total: Number(header[2]),
    units,
    truncated: header[4],
    body: context.slice(start, start + units),
    suffix: context.slice(start + units)
  }
}

function expectSafe(chunks: string[]) {
  for (const chunk of chunks) {
    expect(chunk.length).toBeLessThanOrEqual(CLAUDE_IDENTITY_CHUNK_UNITS)
    expect(chunk).not.toMatch(/[\uD800-\uDBFF]$/)
    expect(chunk).not.toMatch(/^[\uDC00-\uDFFF]/)
  }
}

describe('Claude identity chunks', () => {
  it('preserves empty and small snapshots exactly', () => {
    expect(splitIdentitySnapshot('')).toEqual([])
    expect(splitIdentitySnapshot('abc')).toEqual(['abc'])
    expect(buildIdentityDelivery('', '/agent', 'batch')).toEqual({
      kind: 'ready',
      contexts: [],
      deliveredUnits: 0,
      omittedUnits: 0,
      truncated: false
    })
    expect(CLAUDE_HOOK_CONTEXT_MAX_UNITS).toBe(10_000)
    expect(CLAUDE_IDENTITY_CHUNK_UNITS).toBe(9_600)
    expect(CLAUDE_IDENTITY_HOOK_SLOTS).toBe(16)
    expect(CLAUDE_IDENTITY_NOMINAL_CAPACITY_UNITS).toBe(153_600)
  })

  it.each([9_999, 10_000, 10_001, 86_178, 153_600, 200_000])('losslessly hard-splits %i single-line units', (units) => {
    const snapshot = '中'.repeat(units)
    const chunks = splitIdentitySnapshot(snapshot)
    expect(chunks.join('')).toBe(snapshot)
    expect(chunks).toHaveLength(Math.ceil(units / 9_600))
    expect(chunks[0]).toBe('中'.repeat(9_600))
    expectSafe(chunks)
  })

  it('moves a cut that would land inside an emoji surrogate pair', () => {
    const snapshot = 'a'.repeat(9_599) + '😀' + 'b'.repeat(9_598) + '😀' + 'tail'
    const chunks = splitIdentitySnapshot(snapshot)
    expect(chunks[0]).toBe('a'.repeat(9_599))
    expect(chunks[1]).toBe('😀' + 'b'.repeat(9_598))
    expect(chunks[2]).toBe('😀tail')
    expect(chunks.join('')).toBe(snapshot)
    expectSafe(chunks)
  })

  it('cuts complete lines without adding or removing line endings', () => {
    const line = 'x'.repeat(98) + '\r\n'
    const snapshot = line.repeat(200)
    expect(splitIdentitySnapshot(snapshot)).toEqual([line.repeat(96), line.repeat(96), line.repeat(8)])
    expect(splitIdentitySnapshot('s'.repeat(1_000) + '\n' + 'x'.repeat(9_000) + '\n' + 'y'.repeat(9_000))).toEqual([
      's'.repeat(1_000) + '\n',
      'x'.repeat(9_000) + '\n',
      'y'.repeat(9_000)
    ])
    expect(splitIdentitySnapshot('abc\ndef\nghi', 8)).toEqual(['abc\ndef\n', 'ghi'])
  })

  it.each([9_999, 10_000, 10_001, 86_178, 153_600])(
    'wraps %i units in complete, independently capped parts',
    (units) => {
      const snapshot = 's'.repeat(units)
      const result = buildIdentityDelivery(snapshot, '/agent', 'batch')
      expect(result.kind).toBe('ready')
      if (result.kind !== 'ready') throw new Error('Expected ready delivery')
      expect(result.truncated).toBe(false)
      expect(result.deliveredUnits).toBe(units)
      expect(result.omittedUnits).toBe(0)
      const parts = result.contexts.map(unwrap)
      expect(parts.map((part) => part.part)).toEqual(Array.from({ length: Math.ceil(units / 9_600) }, (_, i) => i + 1))
      for (const [i, part] of parts.entries()) {
        expect(part.total).toBe(parts.length)
        expect(part.truncated).toBe('false')
        expect(part.units).toBe(part.body.length)
        expect(part.suffix).toBe('\n</agent_identity_part>')
        expect(result.contexts[i].length).toBeLessThanOrEqual(10_000)
      }
      expect(parts.map((part) => part.body).join('')).toBe(snapshot)
    }
  )

  it.each(['/agent', '/' + 'a'.repeat(2_700), '/智能体/' + '中文'.repeat(1_350)])(
    'reserves space for exact overflow counts and full paths (%s)',
    (agentPath) => {
      const snapshot = '中'.repeat(200_000)
      const result = buildIdentityDelivery(snapshot, agentPath, 'batch')
      if (result.kind !== 'ready') throw new Error('Expected representable overflow')
      expect(result.truncated).toBe(true)
      expect(result.contexts).toHaveLength(16)
      const parts = result.contexts.map(unwrap)
      expect(parts.map((p) => p.part)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1))
      expect(parts.map((p) => p.body).join('')).toBe(snapshot.slice(0, result.deliveredUnits))
      expect(result.omittedUnits).toBe(200_000 - result.deliveredUnits)
      expect(result.omittedUnits).toBeGreaterThan(0)
      for (const [i, part] of parts.entries()) {
        expect(part.truncated).toBe('true')
        expect(part.total).toBe(16)
        expect(result.contexts[i].length).toBeLessThanOrEqual(10_000)
      }
      const notice = parts.at(-1)!.suffix
      expect(notice).toContain('snapshotUnits="200000"')
      expect(notice).toContain(`deliveredUnits="${result.deliveredUnits}"`)
      expect(notice).toContain(`omittedUnits="${result.omittedUnits}"`)
      for (const file of ['SOUL.md', 'USER.md', 'memory/FACT.md']) expect(notice).toContain(path.join(agentPath, file))
      expect(notice).toContain('Omitted content is unknown. Do not fill it from any earlier snapshot.')
      expect(notice).not.toContain('</facts>')
    }
  )

  it('uses actual slice count when surrogate-safe cuts exceed nominal capacity', () => {
    const snapshot = 'a'.repeat(9_599) + '😀' + 'b'.repeat(153_600 - 9_601)
    expect(snapshot.length).toBe(153_600)
    expect(splitIdentitySnapshot(snapshot)).toHaveLength(17)
    const delivery = buildIdentityDelivery(snapshot, '/agent', 'batch')
    if (delivery.kind !== 'ready') throw new Error('Expected ready delivery')
    expect(delivery.truncated).toBe(true)
    expect(delivery.omittedUnits).toBeGreaterThan(0)
    const bodies = delivery.contexts.map(unwrap).map((p) => p.body)
    expectSafe(bodies)
    expect(bodies.join('')).toBe(snapshot.slice(0, delivery.deliveredUnits))
  })

  it('refuses an overflow notice that cannot fit even without any final body', () => {
    expect(buildIdentityDelivery('x'.repeat(200_000), '/' + '长'.repeat(4_000), 'batch')).toEqual({
      kind: 'unrepresentable',
      reason: 'overflow-notice-too-large'
    })
  })
})
