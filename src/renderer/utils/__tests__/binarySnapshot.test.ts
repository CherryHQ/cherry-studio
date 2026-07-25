import type { BinaryToolSnapshot } from '@shared/types/binary'
import { describe, expect, it } from 'vitest'

import { interpretBinarySnapshot } from '../binarySnapshot'

const definition = { name: 'gh', tool: 'gh' }

describe('interpretBinarySnapshot', () => {
  it('reads an absent snapshot as a not-installed tool', () => {
    const view = interpretBinarySnapshot(undefined)
    expect(view).toMatchObject({ source: 'none', installed: false, hasUpdate: false })
    expect(view.installedVersion).toBeUndefined()
    expect(view.systemPath).toBeUndefined()
    expect(view.resolvedPath).toBeUndefined()
  })

  it('flags an update only for an exactly-applied tool with a newer release', () => {
    const snapshot: BinaryToolSnapshot = {
      name: 'gh',
      definition,
      availability: { source: 'mise', path: '/shims/gh', version: '1.0.0' },
      application: { status: 'applied', version: '1.0.0' }
    }
    const view = interpretBinarySnapshot(snapshot, { latest: '1.1.0' })
    expect(view).toMatchObject({
      source: 'mise',
      installed: true,
      installedVersion: '1.0.0',
      resolvedPath: '/shims/gh',
      applicationStatus: 'applied',
      exactApplied: true,
      applicationVersion: '1.0.0',
      hasUpdate: true
    })
    expect(view.systemPath).toBeUndefined()
  })

  it('does not flag an update when the latest version is not newer', () => {
    const snapshot: BinaryToolSnapshot = {
      name: 'gh',
      definition,
      availability: { source: 'mise', path: '/shims/gh', version: '1.1.0' },
      application: { status: 'applied', version: '1.1.0' }
    }
    expect(interpretBinarySnapshot(snapshot, { latest: '1.1.0' }).hasUpdate).toBe(false)
  })

  it('never flags an update for a tool with no application fact even when a newer version exists', () => {
    const snapshot: BinaryToolSnapshot = {
      name: 'gh',
      availability: { source: 'mise', path: '/shims/gh', version: '1.0.0' }
    }
    const view = interpretBinarySnapshot(snapshot, { latest: '2.0.0' })
    expect(view.exactApplied).toBe(false)
    expect(view.applicationStatus).toBeUndefined()
    expect(view.hasUpdate).toBe(false)
  })

  it('never flags an update for a tool that is not exactly applied', () => {
    // Update gates on application=applied: an entry whose exact recipe is not
    // applied must not offer an update.
    const snapshot: BinaryToolSnapshot = {
      name: 'gh',
      definition,
      availability: { source: 'system', path: '/usr/bin/gh' },
      application: { status: 'broken', version: '1.0.0' }
    }
    expect(interpretBinarySnapshot(snapshot, { latest: '2.0.0' }).hasUpdate).toBe(false)
  })

  it('never flags an update for a runnable conflict', () => {
    // A foreign shim mise still resolves is runnable (availability=mise) but not
    // our exact recipe, so it carries no trusted version and cannot update.
    const snapshot: BinaryToolSnapshot = {
      name: 'gh',
      availability: { source: 'mise', path: '/shims/gh' },
      application: { status: 'conflict' }
    }
    const view = interpretBinarySnapshot(snapshot, { latest: '2.0.0' })
    expect(view).toMatchObject({ source: 'mise', applicationStatus: 'conflict', exactApplied: false, hasUpdate: false })
    expect(view.applicationVersion).toBeUndefined()
  })

  it('never flags an update for an external (system) source', () => {
    const snapshot: BinaryToolSnapshot = {
      name: 'gh',
      availability: { source: 'system', path: '/usr/bin/gh' },
      application: { status: 'absent' }
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
})
