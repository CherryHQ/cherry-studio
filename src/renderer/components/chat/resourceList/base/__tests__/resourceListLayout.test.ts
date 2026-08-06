import { describe, expect, it } from 'vitest'

import { getResourceListItemActionYieldClassName } from '../resourceListLayout'

describe('resourceListLayout', () => {
  it('derives the title reserve from the rendered action slots', () => {
    const singleActionClasses = getResourceListItemActionYieldClassName(1)?.split(' ')
    const doubleActionClasses = getResourceListItemActionYieldClassName(2)?.split(' ')

    expect(singleActionClasses).toContain('group-has-[[data-resource-list-item-actions][data-active=true]]:mr-7')
    expect(doubleActionClasses).toContain('group-has-[[data-resource-list-item-actions][data-active=true]]:mr-12')
  })
})
