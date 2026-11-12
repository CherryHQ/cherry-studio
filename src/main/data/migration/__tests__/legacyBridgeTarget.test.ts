import { describe, expect, it } from 'vitest'

import { findLegacyBridgeTarget, getLegacyBridgeVersion } from '../legacyBridgeTarget'

const record = (version: string, time = '2026-09-01T00:00:00.000Z') => `${version}|mac|prod|packaged|install|${time}`

describe('bridge installation eligibility', () => {
  it('requires a recorded compatible v1 launch, even after an interrupted v2 launch', () => {
    expect(getLegacyBridgeVersion(record('1.9.12'), 'darwin')).toBe('2.1.0')
    expect(
      getLegacyBridgeVersion(`${record('1.9.12')}\n${record('2.1.0', '2026-10-01T00:00:00.000Z')}`, 'darwin')
    ).toBe('2.1.0')
    expect(getLegacyBridgeVersion(record('2.1.0'), 'darwin')).toBeUndefined()
    expect(
      getLegacyBridgeVersion(`${record('1.9.12')}\n${record('1.9.11', '2026-10-01T00:00:00.000Z')}`, 'darwin')
    ).toBe('1.9.12')
  })

  it.each([
    '',
    '1.9.12',
    record('1.9.12-beta.1'),
    record('1.9.12', 'bad-date'),
    record('1.9.12').replace('|install|', '|portable|'),
    `${record('1.9.12')}\nbroken`
  ])('does not guess compatibility from %s', (history) => {
    expect(getLegacyBridgeVersion(history, 'darwin')).toBeUndefined()
  })

  it('does not reuse a different OS history or accept conflicting chronological records', () => {
    expect(getLegacyBridgeVersion(record('1.9.12'), 'win32')).toBeUndefined()
    expect(
      getLegacyBridgeVersion(`${record('1.9.12')}\n${record('1.9.13', '2026-08-01T00:00:00.000Z')}`, 'darwin')
    ).toBeUndefined()
  })

  it('pins the prerequisite and migration releases to signed Global x64 portable assets', () => {
    const prerequisite = findLegacyBridgeTarget('global', 'win32', 'x64', undefined, true, '1.9.12')!
    const bridge = findLegacyBridgeTarget('global', 'win32', 'x64', undefined, true, '2.1.0')!
    expect(prerequisite.version).toBe('1.9.12')
    expect(bridge.version).toBe('2.1.0')
    for (const target of [prerequisite, bridge]) {
      expect(new URL(target.url).hostname).toBe('gitcode.com')
      expect(target.url).toContain(`/v${target.version}/`)
      expect(Buffer.from(target.sha512, 'base64')).toHaveLength(64)
    }
    expect(findLegacyBridgeTarget('cn', 'win32', 'x64', undefined, true, '1.9.12')).toBeUndefined()
    expect(findLegacyBridgeTarget('global', 'win32', 'x64', undefined, false, '1.9.12')).toBeUndefined()
  })

  it.each(['global', 'cn'] as const)(
    'pins the complete %s platform matrix to the migration-capable release',
    (edition) => {
      for (const platform of ['darwin', 'win32', 'linux']) {
        for (const arch of ['arm64', 'x64']) {
          const target = findLegacyBridgeTarget(edition, platform, arch)
          expect(target).toBeDefined()
          expect(target!.url).toContain('/releases/download/v2.1.0/Cherry-Studio-')
          expect(target!.url.includes('-CN-')).toBe(edition === 'cn')
          expect(target!.url).toContain(`-${arch}`)
          expect(Buffer.from(target!.sha512, 'base64')).toHaveLength(64)
          expect(new URL(target!.url).hostname).toBe('github.com')
        }
      }
      expect(findLegacyBridgeTarget(edition, 'darwin', 'ia32')).toBeUndefined()
      expect(findLegacyBridgeTarget(edition, 'freebsd', 'x64')).toBeUndefined()
    }
  )
})
