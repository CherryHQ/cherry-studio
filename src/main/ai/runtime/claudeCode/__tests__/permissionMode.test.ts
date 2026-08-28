import { describe, expect, it } from 'vitest'

import { toSdkPermissionMode } from '../permissionMode'

describe('toSdkPermissionMode', () => {
  it.each(['default', 'edit', 'auto', 'plan', 'acceptEdits', undefined, null])('maps %s to SDK default', (mode) => {
    expect(toSdkPermissionMode(mode)).toBe('default')
  })

  it.each(['full', 'bypassPermissions'])('maps %s to SDK bypassPermissions', (mode) => {
    expect(toSdkPermissionMode(mode)).toBe('bypassPermissions')
  })
})
