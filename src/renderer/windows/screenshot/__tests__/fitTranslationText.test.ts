import { describe, expect, it } from 'vitest'

import { fitTranslationText } from '../utils/fitTranslationText'

const measure = (text: string, size: number) => ({
  width: text.length * size,
  left: size,
  right: text.length * size,
  ascent: size * 0.7,
  descent: size * 0.2
})

describe('fitTranslationText', () => {
  it('fits complete normalized text including overhang', () => {
    const result = fitTranslationText('a\n b', { x: 0, y: 0, width: 30, height: 20 }, 1, measure)
    expect(result).not.toBeNull()
    expect(result!.fontSizePx * 4).toBeLessThanOrEqual(30)
  })
  it('rejects text that cannot fit at the CSS floor and tiny boxes', () => {
    expect(fitTranslationText('unbreakable token', { x: 0, y: 0, width: 10, height: 20 }, 1, measure)).toBeNull()
    expect(fitTranslationText('a', { x: 0, y: 0, width: 100, height: 2 }, 1, measure)).toBeNull()
    expect(fitTranslationText('a', { x: 0, y: 0, width: 100, height: 10 }, 2, measure)).toBeNull()
  })
})
