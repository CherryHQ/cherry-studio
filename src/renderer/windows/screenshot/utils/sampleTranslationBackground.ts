import type { PhysicalBox } from '../types'

export function sampleTranslationBackground(
  imageData: ImageData,
  box: PhysicalBox,
  excludedBoxes: readonly PhysicalBox[]
): { r: number; g: number; b: number } | null {
  const channels: number[][] = [[], [], []]
  for (let y = Math.max(0, box.y - 2); y < Math.min(imageData.height, box.y + box.height + 2); y++) {
    for (let x = Math.max(0, box.x - 2); x < Math.min(imageData.width, box.x + box.width + 2); x++) {
      const contains = (b: PhysicalBox) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height
      if (contains(box) || excludedBoxes.some(contains)) continue
      const offset = (y * imageData.width + x) * 4
      if (imageData.data[offset + 3] === 0) continue
      for (let c = 0; c < 3; c++) channels[c].push(imageData.data[offset + c])
    }
  }
  if (!channels[0].length) return null
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)]
  return { r: median(channels[0]), g: median(channels[1]), b: median(channels[2]) }
}
