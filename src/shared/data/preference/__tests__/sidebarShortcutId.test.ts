import { describe, expect, it } from 'vitest'

import { createSidebarShortcutId, type SidebarShortcutTarget } from '../preferenceTypes'

describe('createSidebarShortcutId', () => {
  it('keeps exact activations distinct and escapes locator delimiters', () => {
    const target: SidebarShortcutTarget = {
      kind: 'resource',
      locator: { providerId: 'third.party', resourceId: 'prompt:one' }
    }

    expect(createSidebarShortcutId(target)).toBe('sidebar-shortcut:third.party:prompt%3Aone')
    expect(createSidebarShortcutId({ ...target, activationId: 'insert:input' })).toBe(
      'sidebar-shortcut:third.party:prompt%3Aone:insert%3Ainput'
    )
  })
})
