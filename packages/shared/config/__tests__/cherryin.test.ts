import { describe, expect, it } from 'vitest'

import { CHERRYIN_HOSTS, getCherryInEndpoints, isCherryInHostMode, resolveCherryInHost } from '../cherryin'

describe('CherryIN endpoint configuration', () => {
  it('derives every CherryIN endpoint from the selected host', () => {
    expect(getCherryInEndpoints(CHERRYIN_HOSTS.china)).toEqual({
      anthropicApiHost: CHERRYIN_HOSTS.china,
      apiHost: CHERRYIN_HOSTS.china,
      apiKey: `${CHERRYIN_HOSTS.china}/console/token`,
      docs: CHERRYIN_HOSTS.china,
      models: `${CHERRYIN_HOSTS.china}/pricing`,
      oauth: CHERRYIN_HOSTS.china,
      official: CHERRYIN_HOSTS.china,
      topup: `${CHERRYIN_HOSTS.china}/console/topup`
    })
  })

  it('normalizes official CherryIN URLs and rejects custom origins', () => {
    expect(resolveCherryInHost(`${CHERRYIN_HOSTS.china}/v1`)).toBe(CHERRYIN_HOSTS.china)
    expect(resolveCherryInHost('https://example.com/v1')).toBe(CHERRYIN_HOSTS.global)
  })

  it('recognizes supported host modes', () => {
    expect(isCherryInHostMode('auto')).toBe(true)
    expect(isCherryInHostMode('china')).toBe(true)
    expect(isCherryInHostMode('global')).toBe(true)
    expect(isCherryInHostMode('custom')).toBe(false)
  })
})
