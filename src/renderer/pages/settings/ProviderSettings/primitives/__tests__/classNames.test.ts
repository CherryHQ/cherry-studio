import { describe, expect, it } from 'vitest'

import { authConnectionClasses, providerDetailColumnClasses } from '../classNames'

describe('provider settings class names', () => {
  it('keeps connection and model-list group spacing consistent', () => {
    expect(authConnectionClasses.body).toContain('gap-5')
    expect(providerDetailColumnClasses.sectionStack).toContain('gap-5')
  })
})
