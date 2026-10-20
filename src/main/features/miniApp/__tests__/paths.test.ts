import { describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { miniAppBackupPath, miniAppDataPath, miniAppInstallPath, miniAppRollingPath } from '../paths'

const ROOTS: Record<string, string> = {
  'feature.mini_app.packages': 'packages',
  'feature.mini_app.snapshots': 'snapshots',
  'feature.mini_app.data': 'data'
}

const mockRoots = (base: string) =>
  vi.mocked(application.getPath).mockImplementation((key: string) => `${base}/${ROOTS[key] ?? key}`)

describe('mini app paths', () => {
  it('derives every path from the registry roots', () => {
    mockRoots('/data/MiniApps')

    expect(miniAppInstallPath('com.example.a')).toBe('/data/MiniApps/packages/com.example.a')
    expect(miniAppBackupPath('com.example.a')).toBe('/data/MiniApps/snapshots/com.example.a.backup')
    expect(miniAppRollingPath('com.example.a')).toBe('/data/MiniApps/snapshots/com.example.a.rolling')
    expect(miniAppDataPath('com.example.a')).toBe('/data/MiniApps/data/com.example.a')
  })

  it('keeps a snapshot off every legal appId install tree', () => {
    // `.` is in the appId alphabet, so `com.example.a.backup` is a LEGAL appId. Held
    // beside the install trees, its package directory would be byte-identical to
    // `com.example.a`'s rollback snapshot: installing it would delete that snapshot,
    // and rolling `com.example.a` back would publish its tree under the other identity.
    mockRoots('/data/MiniApps')

    expect(miniAppInstallPath('com.example.a.backup')).not.toBe(miniAppBackupPath('com.example.a'))
    expect(miniAppInstallPath('com.example.a.rolling')).not.toBe(miniAppRollingPath('com.example.a'))
  })

  it('follows the root when userData moves', () => {
    // The bug this guards: caching or persisting the resolved path. A relocation
    // copies the whole tree, so a stored absolute path breaks every installed app.
    mockRoots('/moved/MiniApps')

    expect(miniAppInstallPath('com.example.a')).toBe('/moved/MiniApps/packages/com.example.a')
    expect(miniAppBackupPath('com.example.a')).toBe('/moved/MiniApps/snapshots/com.example.a.backup')
  })
})
