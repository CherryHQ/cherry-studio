import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

describe('VersionService launch kind', () => {
  let dir: string
  let logPath: string

  beforeEach(() => {
    vi.resetModules()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-version-log-'))
    logPath = path.join(dir, 'version.log')
    vi.mocked(application.getPath).mockReturnValue(logPath)
  })

  afterEach(() => {
    vi.mocked(application.getPath).mockReset()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const loadService = async () => (await import('../VersionService')).versionService

  it('treats a launch with no version history as the first one, even after recording it', async () => {
    const versionService = await loadService()

    versionService.recordCurrentVersion()

    expect(fs.readFileSync(logPath, 'utf8')).toContain('1.0.0|')
    expect(versionService.getLaunchKind()).toBe('first')
  })

  it('treats a different last recorded version as an upgrade', async () => {
    fs.writeFileSync(logPath, '0.9.0|mac|prod|packaged|install|2026-01-01T00:00:00.000Z\n')
    const versionService = await loadService()

    expect(versionService.getLaunchKind()).toBe('upgraded')
    versionService.recordCurrentVersion()
    expect(versionService.getLaunchKind()).toBe('upgraded')
  })

  it('treats the same last recorded version as a repeat launch', async () => {
    fs.writeFileSync(logPath, '1.0.0|mac|prod|packaged|install|2026-01-01T00:00:00.000Z\n')
    const versionService = await loadService()

    expect(versionService.getLaunchKind()).toBe('same')
  })
})
