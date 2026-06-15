import { describe, expect, it } from 'vitest'

import { devtoolsRequestSchemas } from '../devtools'

describe('devtoolsRequestSchemas', () => {
  it('declares exactly the migrated devtools routes', () => {
    expect(Object.keys(devtoolsRequestSchemas)).toEqual(['devtools.toggle'])
  })

  it('toggle accepts void input and returns void output', () => {
    expect(devtoolsRequestSchemas['devtools.toggle'].input.safeParse(undefined).success).toBe(true)
    expect(devtoolsRequestSchemas['devtools.toggle'].output.safeParse(undefined).success).toBe(true)
  })
})
