import { describe, expect, it } from 'vitest'

import { getFileNameWithExt } from '../file'

describe('getFileNameWithExt', () => {
  it('appends the extension when present', () => {
    expect(getFileNameWithExt({ name: 'report', ext: 'pdf' })).toBe('report.pdf')
  })

  it('returns the name unchanged for extensionless files', () => {
    expect(getFileNameWithExt({ name: 'Dockerfile', ext: null })).toBe('Dockerfile')
  })
})
