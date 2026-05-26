import { beforeEach, describe, expect, it } from 'vitest'

import { ReduxExporter } from '../ReduxExporter'

const PERSIST_KEY = 'persist:cherry-studio'

describe('ReduxExporter', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('exports persisted paintings slice for v2 migration', () => {
    const paintings = {
      tokenflux_paintings: [
        {
          id: '3e3e0e76-a41d-41d1-91e4-50497f2d9e30',
          prompt: 'paint a mountain'
        }
      ]
    }

    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({
        paintings: JSON.stringify(paintings)
      })
    )

    const result = new ReduxExporter().export()

    expect(result.slicesFound).toContain('paintings')
    expect(result.data.paintings).toEqual(paintings)
  })
})
