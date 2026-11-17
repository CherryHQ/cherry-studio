import { describe, expect, it } from 'vitest'

import { getSelectionToolbarSize } from '../selectionToolbarSize'

describe('getSelectionToolbarSize', () => {
  it.each([
    [350, 43, 1, 350, 43],
    [350, 43, 1.5, 525, 65],
    [351, 43, 1.1, 387, 48],
    [350, 43, 0.5, 175, 22],
    [350, 43, 2, 700, 86]
  ])(
    'converts %s × %s CSS px at zoom %s into %s × %s whole DIP',
    (width, height, zoom, expectedWidth, expectedHeight) => {
      const size = getSelectionToolbarSize(width, height, zoom)

      expect(size).toEqual({ toolbarWidth: expectedWidth, toolbarHeight: expectedHeight })
      expect(Number.isInteger(size.toolbarWidth)).toBe(true)
      expect(Number.isInteger(size.toolbarHeight)).toBe(true)
    }
  )
})
