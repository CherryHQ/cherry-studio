import { describe, expect, it } from 'vitest'

import { readPreferenceAnalyticsKinds } from '../../../../scripts/generate-preference-analytics-catalog'
import { PREFERENCE_ANALYTICS_CATALOG } from '../analyticsPreferenceCatalog.gen'

describe('analytics preference catalog', () => {
  // A stale catalog could report a new free-text setting's value; run `pnpm gen:preference-analytics-catalog`.
  it('matches the current Preference schema', () => {
    expect(PREFERENCE_ANALYTICS_CATALOG).toEqual(readPreferenceAnalyticsKinds())
  }, 30_000)
})
