import { describe, expect, it } from 'vitest'

import { CHERRYIN_HOSTS, getCherryInEndpoints, isCherryInHostMode, resolveCherryInHost } from '../cherryin'

describe('CherryIN endpoint config', () => {
  it('builds every public link from one host', () => {
    expect(getCherryInEndpoints(CHERRYIN_HOSTS.china)).toEqual({
      apiKey: `${CHERRYIN_HOSTS.china}/console/token`,
      docs: CHERRYIN_HOSTS.china,
      models: `${CHERRYIN_HOSTS.china}/pricing`,
      oauth: CHERRYIN_HOSTS.china,
      official: CHERRYIN_HOSTS.china,
      topup: `${CHERRYIN_HOSTS.china}/console/topup`
    })
  })

  it('recognizes modes and resolves only official hosts', () => {
    expect(isCherryInHostMode('auto')).toBe(true)
    expect(isCherryInHostMode('china')).toBe(true)
    expect(isCherryInHostMode('other')).toBe(false)
    expect(resolveCherryInHost(`${CHERRYIN_HOSTS.global}/v1`)).toBe(CHERRYIN_HOSTS.global)
    expect(resolveCherryInHost('https://example.com')).toBe(CHERRYIN_HOSTS.global)
  })
})
