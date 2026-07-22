import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prewarmCherryInEndpoint } from '../CherryINEndpointService'

describe('prewarmCherryInEndpoint', () => {
  const getEndpointSelection = vi.fn()

  beforeEach(() => {
    getEndpointSelection.mockReset().mockResolvedValue(undefined)
    window.api.cherryin = {
      ...window.api.cherryin,
      getEndpointSelection
    }
  })

  it('skips endpoint selection when the CherryIN provider is disabled', async () => {
    await prewarmCherryInEndpoint(false)

    expect(getEndpointSelection).not.toHaveBeenCalled()
  })

  it('prewarms endpoint selection when the CherryIN provider is enabled', async () => {
    await prewarmCherryInEndpoint(true)

    expect(getEndpointSelection).toHaveBeenCalledOnce()
  })
})
