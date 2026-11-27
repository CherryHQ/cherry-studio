import { describe, expect, it } from 'vitest'

import { SELECTION_PREDEFINED_BLACKLIST } from '../selectionConfig'

describe('Windows screenshot exclusion policy', () => {
  it.each(['snippingtool.exe', 'screenclippinghost.exe'])(
    'predefines an exclusion for the system capture host %s',
    (programName) => {
      expect(SELECTION_PREDEFINED_BLACKLIST.WINDOWS).toContain(programName)
    }
  )

  it.each(['snipaste.exe', 'pixpin.exe', 'sharex.exe'])('retains the screenshot exclusion for %s', (programName) => {
    expect(SELECTION_PREDEFINED_BLACKLIST.WINDOWS).toContain(programName)
  })
})
