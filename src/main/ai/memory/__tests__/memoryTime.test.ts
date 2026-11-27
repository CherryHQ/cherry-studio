import { describe, expect, it } from 'vitest'

import type { MemoryCandidate } from '@shared/types/memory'

import { anchorMemoryTime } from '../memoryTime'

describe('memory source-time anchors', () => {
  it.each([
    ['希望明年进入八强，赛事未定。', '明年', '2026-11-17T12:00:00Z', '2027年'],
    ['上个月搬家，具体日期不记得。', '上个月', '2026-01-17T12:00:00Z', '2025-12'],
    ['明天参加比赛。', '明天', '2026-12-31T12:00:00Z', '2027-01-01'],
    ['最近考虑学潜水，尚未决定。', '最近', '2026-11-17T12:00:00Z', '最近考虑'],
    ['去年曾希望明年参赛，时间还不明确。', '明年', '2026-11-17T12:00:00Z', '去年曾希望明年参赛'],
    [
      'In 2019 I said I might move next year.',
      'next year',
      '2026-11-17T12:00:00Z',
      '2019 I said I might move next year'
    ]
  ])('preserves precision and conditions for %s', (text, time, at, expected) => {
    const candidate = { text, time, evidence: [{ messageId: 'u' }] } as MemoryCandidate
    const result = anchorMemoryTime(candidate, [{ id: 'u', createdAt: Date.parse(at) }], 'Asia/Shanghai')
    expect(result).toContain(expected)
    expect(result).not.toMatch(/Asia\/Shanghai|timezone|时区/)
    expect(result).toContain(at.slice(0, 10))
  })

  it('uses the source timezone and retains relative wording when evidence spans dates', () => {
    const candidate = {
      text: 'I hope to win next year; nothing is booked.',
      time: 'next year',
      evidence: [{ messageId: 'a' }]
    } as MemoryCandidate
    const messages = [
      { id: 'a', createdAt: Date.parse('2026-12-31T17:00:00Z') },
      { id: 'b', createdAt: Date.parse('2026-12-30T17:00:00Z') }
    ]
    expect(anchorMemoryTime(candidate, messages, 'Asia/Shanghai')).toContain('win 2028')
    candidate.evidence.push({ messageId: 'b', quote: 'next year', version: 'v' })
    expect(anchorMemoryTime(candidate, messages, 'Asia/Shanghai')).toContain('next year')
    expect(anchorMemoryTime(candidate, messages, 'Asia/Shanghai')).toContain('2027-01-01, 2026-12-31')
  })
})
