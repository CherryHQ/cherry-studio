import { describe, expect, it } from 'vitest'

import { getFormatLabel } from '../fileDisplay'

describe('file format labels', () => {
  it.each(['constructor', '__proto__', 'toString'])('formats an unrecognized %s extension as text', (format) => {
    expect(getFormatLabel(format)).toBe(format.toUpperCase())
  })
})
