import { beforeEach, describe, expect, it } from 'vitest'

import { defineUtilityProcess } from '../defineUtilityProcess'
import {
  __resetInstalledUtilityProcessManifestForTesting,
  getInstalledUtilityProcessManifest,
  installUtilityProcessManifest
} from '../installedManifest'
import type { UtilityProcessContract } from '../types'

const alpha = defineUtilityProcess<UtilityProcessContract>({
  id: 'test.alpha',
  entry: 'alpha',
  cancellation: 'terminate'
})
const beta = defineUtilityProcess<UtilityProcessContract>({
  id: 'test.beta',
  entry: 'beta',
  cancellation: 'cooperative'
})

beforeEach(() => {
  __resetInstalledUtilityProcessManifestForTesting()
})

describe('installUtilityProcessManifest', () => {
  it('exposes each installed definition by id, as the same object', () => {
    installUtilityProcessManifest([alpha, beta])

    const installed = getInstalledUtilityProcessManifest()
    expect(installed.get('test.alpha')).toBe(alpha)
    expect(installed.get('test.beta')).toBe(beta)
    expect(installed.size).toBe(2)
  })

  it('throws before installation so a misordered boot fails fast', () => {
    expect(() => getInstalledUtilityProcessManifest()).toThrow(/not installed/)
  })

  it('refuses a second installation', () => {
    installUtilityProcessManifest([alpha])
    expect(() => installUtilityProcessManifest([beta])).toThrow(/already installed/)
    expect(getInstalledUtilityProcessManifest().has('test.beta')).toBe(false)
  })

  it('refuses duplicate ids and invalid definitions, leaving nothing installed', () => {
    expect(() => installUtilityProcessManifest([alpha, { ...alpha }])).toThrow(/more than once/)
    expect(() => getInstalledUtilityProcessManifest()).toThrow(/not installed/)

    expect(() => installUtilityProcessManifest([{ ...alpha, idleTimeoutMs: 0 }])).toThrow(TypeError)
    expect(() => getInstalledUtilityProcessManifest()).toThrow(/not installed/)
  })
})
