import sharp from 'sharp'
import { expect } from 'vitest'

export async function assertQuadrants(content: Uint8Array): Promise<void> {
  const { data, info } = await sharp(content).raw().toBuffer({ resolveWithObject: true })
  expect([info.width, info.height, info.channels]).toEqual([96, 64, 4])
  for (const [x, y, color] of [
    [24, 16, [220, 30, 40]],
    [72, 16, [30, 160, 60]],
    [24, 48, [40, 60, 200]],
    [72, 48, [245, 245, 245]],
    [12, 12, [0, 0, 0]]
  ] as const) {
    for (const [channel, expected] of color.entries())
      expect(Math.abs(data[(y * info.width + x) * 4 + channel] - expected)).toBeLessThanOrEqual(12)
    expect(data[(y * info.width + x) * 4 + 3]).toBe(255)
  }
}
