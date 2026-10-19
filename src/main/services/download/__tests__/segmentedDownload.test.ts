import { describe, expect, it } from 'vitest'

import { planSegments, receivedBytes, resumeOffset, segmentLength } from '../segmentedDownload'

describe('planSegments', () => {
  it('plans one range when the size is unknown', () => {
    expect(planSegments(0, 8, 1)).toEqual([{ index: 0, start: 0, end: 0 }])
    expect(planSegments(-1, 8, 1)).toEqual([{ index: 0, start: 0, end: 0 }])
  })

  it('keeps files smaller than one segment on a single connection', () => {
    expect(planSegments(1024, 8, 4 * 1024 * 1024)).toEqual([{ index: 0, start: 0, end: 1024 }])
  })

  it('distributes the remainder onto the earliest ranges', () => {
    expect(planSegments(10, 4, 1)).toEqual([
      { index: 0, start: 0, end: 3 },
      { index: 1, start: 3, end: 6 },
      { index: 2, start: 6, end: 8 },
      { index: 3, start: 8, end: 10 }
    ])
  })

  it('covers the file contiguously with no gaps or overlap', () => {
    const ranges = planSegments(1_000_003, 7, 1)
    expect(ranges[0].start).toBe(0)
    expect(ranges.at(-1)?.end).toBe(1_000_003)
    for (let index = 1; index < ranges.length; index++) {
      expect(ranges[index].start).toBe(ranges[index - 1].end)
    }
    expect(ranges.reduce((sum, range) => sum + segmentLength(range), 0)).toBe(1_000_003)
  })

  it('clamps connections to at least one and at most sixteen', () => {
    expect(planSegments(100, 0, 1)).toHaveLength(1)
    expect(planSegments(100, -4, 1)).toHaveLength(1)
    expect(planSegments(100, 99, 1)).toHaveLength(16)
  })

  it('does not split more finely than the minimum segment size', () => {
    expect(planSegments(10 * 1024 * 1024, 8, 4 * 1024 * 1024)).toHaveLength(3)
  })
})

describe('progress helpers', () => {
  it('sums received bytes clamped to each range', () => {
    const ranges = planSegments(10, 2, 1)
    expect(receivedBytes(ranges, [5, 5])).toBe(10)
    expect(receivedBytes(ranges, [99, 99])).toBe(10)
    expect(receivedBytes(ranges, [0, 2])).toBe(2)
  })

  it('resumes at the recorded offset inside a range', () => {
    const range = { index: 1, start: 100, end: 200 }
    expect(resumeOffset(range, 0)).toBe(100)
    expect(resumeOffset(range, 25)).toBe(125)
    expect(resumeOffset(range, 500)).toBe(200)
  })
})
