import { describe, expect, it } from 'vitest'

import { formatBadgeLabel, renderTaskbarBadgeBitmap } from '../taskbarBadgeIcon'

describe('taskbarBadgeIcon', () => {
  it('caps the label so large counts stay legible', () => {
    expect(formatBadgeLabel(1)).toBe('1')
    expect(formatBadgeLabel(9)).toBe('9')
    expect(formatBadgeLabel(10)).toBe('9+')
  })

  it('renders an opaque circle with transparent corners and a different glyph per count', () => {
    const one = renderTaskbarBadgeBitmap(1)
    const two = renderTaskbarBadgeBitmap(2)
    const alphaAt = (buffer: Buffer, x: number, y: number) => buffer[(y * one.width + x) * 4 + 3]

    expect(one.buffer.length).toBe(one.width * one.height * 4)
    expect(alphaAt(one.buffer, 0, 0)).toBe(0)
    expect(alphaAt(one.buffer, 16, 4)).toBe(255)
    expect(one.buffer.equals(two.buffer)).toBe(false)
  })
})
