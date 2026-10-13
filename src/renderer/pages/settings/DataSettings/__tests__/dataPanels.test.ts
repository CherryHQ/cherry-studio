import { describe, expect, it } from 'vitest'

import { DATA_PANEL_KEYS, dataPanelSearchSchema } from '../dataPanels'

describe('dataPanelSearchSchema', () => {
  it('accepts every menu panel key', () => {
    for (const key of DATA_PANEL_KEYS) {
      expect(dataPanelSearchSchema.parse({ panel: key })).toEqual({ panel: key })
    }
  })

  it('degrades unknown panel values to no param instead of throwing', () => {
    // Hand-edited or stale URLs must land on the default panel, never a blank column
    expect(dataPanelSearchSchema.parse({ panel: 'does-not-exist' })).toEqual({ panel: undefined })
    expect(dataPanelSearchSchema.parse({ panel: 42 })).toEqual({ panel: undefined })
  })

  it('treats a missing panel as optional', () => {
    expect(dataPanelSearchSchema.parse({})).toEqual({})
  })
})
