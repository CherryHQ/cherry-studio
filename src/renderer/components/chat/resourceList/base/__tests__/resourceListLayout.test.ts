import { describe, expect, it } from 'vitest'

import { RESOURCE_LIST_TITLE_FADE_YIELD_CLASS } from '../resourceListLayout'

describe('resourceListLayout', () => {
  it('reserves both action slots while an item action is forced active', () => {
    const classes = RESOURCE_LIST_TITLE_FADE_YIELD_CLASS.split(' ')

    expect(classes).toContain('group-has-[[data-resource-list-item-actions][data-active=true]]:mr-12')
    expect(classes).not.toContain('group-has-[[data-resource-list-item-actions][data-active=true]]:mr-7')
  })
})
