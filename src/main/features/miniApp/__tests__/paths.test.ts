import { application } from '@application'
import { describe, expect, it, vi } from 'vitest'

import { miniAppBackupPath, miniAppDataPath, miniAppInstallPath, miniAppRollingPath } from '../paths'

const mockRoots = (base: string) =>
  vi
    .mocked(application.getPath)
    .mockImplementation((key: string) => (key === 'feature.mini_app.data' ? `${base}/data` : `${base}/packages`))

describe('mini app paths', () => {
  it('derives every path from the registry roots', () => {
    mockRoots('/data/MiniApps')

    expect(miniAppInstallPath('com.example.a')).toBe('/data/MiniApps/packages/com.example.a')
    // `.backup` / `.rolling` are SIBLINGS inside packages/ — appIds cannot start with a dot.
    expect(miniAppBackupPath('com.example.a')).toBe('/data/MiniApps/packages/com.example.a.backup')
    expect(miniAppRollingPath('com.example.a')).toBe('/data/MiniApps/packages/com.example.a.rolling')
    expect(miniAppDataPath('com.example.a')).toBe('/data/MiniApps/data/com.example.a')
  })

  it('follows the root when userData moves', () => {
    // The bug this guards: caching or persisting the resolved path. A relocation
    // copies the whole tree, so a stored absolute path breaks every installed app.
    mockRoots('/moved/MiniApps')

    expect(miniAppInstallPath('com.example.a')).toBe('/moved/MiniApps/packages/com.example.a')
  })
})
