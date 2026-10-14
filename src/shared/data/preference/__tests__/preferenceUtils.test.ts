/**
 * Tests for the boot config key boundary in preferenceUtils.
 *
 * Internal `temp.*` boot config keys (main-process transient state) must be
 * excluded from the unified preference surface — both at the type level
 * (UnifiedPreferenceKeyType) and at runtime (isPublicBootConfigKey whitelist).
 */
import { describe, expect, expectTypeOf, it } from 'vitest'

import type { UnifiedPreferenceKeyType } from '../preferenceTypes'
import { isPublicBootConfigKey } from '../preferenceUtils'

const PUBLIC_KEY = 'BootConfig.app.disable_hardware_acceleration'
const INTERNAL_KEY = 'BootConfig.temp.user_data_relocation'
const UNKNOWN_KEY = 'BootConfig.foo.does_not_exist'
const DB_PREFERENCE_KEY = 'app.language'

describe('isPublicBootConfigKey', () => {
  it('accepts a public BootConfig key', () => {
    expect(isPublicBootConfigKey(PUBLIC_KEY)).toBe(true)
  })

  it('rejects an internal temp.* BootConfig key', () => {
    expect(isPublicBootConfigKey(INTERNAL_KEY)).toBe(false)
  })

  it('rejects an unknown/junk BootConfig key', () => {
    expect(isPublicBootConfigKey(UNKNOWN_KEY)).toBe(false)
  })

  it('rejects a non-BootConfig (DB preference) key', () => {
    expect(isPublicBootConfigKey(DB_PREFERENCE_KEY)).toBe(false)
  })
})

describe('UnifiedPreferenceKeyType boundary', () => {
  it('includes public BootConfig keys and excludes internal temp.* keys', () => {
    // Extract<Union, Lit> is Lit when Lit is a member of the union, else never.
    expectTypeOf<
      Extract<UnifiedPreferenceKeyType, 'BootConfig.app.disable_hardware_acceleration'>
    >().toEqualTypeOf<'BootConfig.app.disable_hardware_acceleration'>()
    expectTypeOf<Extract<UnifiedPreferenceKeyType, 'BootConfig.temp.user_data_relocation'>>().toEqualTypeOf<never>()
  })
})
