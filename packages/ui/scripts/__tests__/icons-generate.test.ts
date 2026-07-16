import { describe, expect, it } from 'vitest'

import { resolveIconTypes } from '../icons-generate'

describe('resolveIconTypes', () => {
  it('generates every icon group when no type is requested', () => {
    expect(resolveIconTypes(null)).toEqual(['icons', 'providers', 'models'])
  })

  it('generates only the requested icon group', () => {
    expect(resolveIconTypes('providers')).toEqual(['providers'])
  })
})
