import { describe, expect, it } from 'vitest'

import { getReleaseTargets } from '../release/targets'

describe('release target selection', () => {
  it('keeps USB signing on one Windows job per edition and separates macOS and Linux architectures', () => {
    const targets = getReleaseTargets('all')
    expect(targets.map(({ platform, arch }) => `${platform}-${arch}`).sort()).toEqual([
      'linux-arm64',
      'linux-x64',
      'mac-arm64',
      'mac-x64',
      'windows-all'
    ])
  })

  it('routes every macOS architecture to the self-hosted Mac Studio', () => {
    expect(getReleaseTargets('mac').map(({ runner }) => runner)).toEqual([
      ['self-hosted', 'mac-studio'],
      ['self-hosted', 'mac-studio']
    ])
  })

  it.each(['windows', 'mac', 'linux'])('builds only the requested %s platform during repair', (platform) => {
    const targets = getReleaseTargets(platform)
    expect(targets.length).toBe(platform === 'windows' ? 1 : 2)
    expect(targets.every((target) => target.platform === platform)).toBe(true)
  })

  it('rejects an unknown platform rather than creating an empty successful build', () => {
    expect(() => getReleaseTargets('other')).toThrow('Unsupported release platform')
  })
})
