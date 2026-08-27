import {
  CHERRY_CLOUD_PROVIDER_ID,
  CHERRYAI_PROVIDER_ID,
  isManagedCherryCloudModel
} from '@shared/data/presets/cherryai'
import { describe, expect, it } from 'vitest'

describe('Cherry Cloud model identity', () => {
  it('uses the owned provider id instead of editable display metadata', () => {
    expect(isManagedCherryCloudModel(CHERRY_CLOUD_PROVIDER_ID)).toBe(true)
    expect(isManagedCherryCloudModel(CHERRYAI_PROVIDER_ID)).toBe(false)
    expect(isManagedCherryCloudModel('custom-provider')).toBe(false)
  })
})
