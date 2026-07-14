import type { BinaryToolSnapshot } from '@shared/types/binary'
import { describe, expect, it } from 'vitest'

import { interpretBinarySnapshot } from '../binarySnapshot'

const intent = { name: 'gh', tool: 'gh' }

describe('interpretBinarySnapshot', () => {
  it('reads an absent snapshot as an unowned, not-installed tool', () => {
    const view = interpretBinarySnapshot(undefined)
    expect(view).toMatchObject({ source: 'none', installed: false, owned: false, hasUpdate: false })
    expect(view.installedVersion).toBeUndefined()
    expect(view.systemPath).toBeUndefined()
    expect(view.resolvedPath).toBeUndefined()
  })

  it('carries the version and update flag for an owned mise tool with a newer release', () => {
    const snapshot: BinaryToolSnapshot = {
      name: 'gh',
      intent,
      availability: { source: 'mise', tool: 'gh', path: '/shims/gh', version: '1.0.0' }
    }
    const view = interpretBinarySnapshot(snapshot, { latest: '1.1.0' })
    expect(view).toMatchObject({
      source: 'mise',
      installed: true,
      owned: true,
      installedVersion: '1.0.0',
      resolvedPath: '/shims/gh',
      hasUpdate: true
    })
    expect(view.systemPath).toBeUndefined()
  })

  it('does not flag an update when the latest version is not newer', () => {
    const snapshot: BinaryToolSnapshot = {
      name: 'gh',
      intent,
      availability: { source: 'mise', tool: 'gh', path: '/shims/gh', version: '1.1.0' }
    }
    expect(interpretBinarySnapshot(snapshot, { latest: '1.1.0' }).hasUpdate).toBe(false)
  })

  it('never flags an update for an unowned tool even when a newer version exists', () => {
    const snapshot: BinaryToolSnapshot = {
      name: 'gh',
      availability: { source: 'mise', tool: 'gh', path: '/shims/gh', version: '1.0.0' }
    }
    expect(interpretBinarySnapshot(snapshot, { latest: '2.0.0' }).hasUpdate).toBe(false)
  })

  it('exposes only resolvedPath (not systemPath) for a bundled tool', () => {
    const snapshot: BinaryToolSnapshot = {
      name: 'gh',
      availability: { source: 'bundled', path: '/bundled/gh', version: '1.0.0' }
    }
    const view = interpretBinarySnapshot(snapshot)
    expect(view).toMatchObject({ source: 'bundled', installedVersion: '1.0.0', resolvedPath: '/bundled/gh' })
    expect(view.systemPath).toBeUndefined()
  })

  it('exposes systemPath and resolvedPath but no version for a system tool', () => {
    const snapshot: BinaryToolSnapshot = { name: 'gh', availability: { source: 'system', path: '/usr/bin/gh' } }
    const view = interpretBinarySnapshot(snapshot)
    expect(view).toMatchObject({
      source: 'system',
      installed: true,
      systemPath: '/usr/bin/gh',
      resolvedPath: '/usr/bin/gh'
    })
    expect(view.installedVersion).toBeUndefined()
  })

  it('collapses a system source to none when ignoreSystemSource is set', () => {
    const snapshot: BinaryToolSnapshot = {
      name: 'openclaw',
      availability: { source: 'system', path: '/usr/bin/openclaw' }
    }
    const view = interpretBinarySnapshot(snapshot, { ignoreSystemSource: true })
    expect(view).toMatchObject({ source: 'none', installed: false })
    expect(view.systemPath).toBeUndefined()
    expect(view.resolvedPath).toBeUndefined()
  })
})
