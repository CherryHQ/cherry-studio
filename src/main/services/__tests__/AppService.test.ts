import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/core/platform', () => ({
  isDev: false,
  isLinux: true,
  isMac: false,
  isWin: false
}))

import { AppService } from '../AppService'

describe('AppService', () => {
  let temporaryDirectory: string
  let autostartDirectory: string

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'app-service-'))
    autostartDirectory = path.join(temporaryDirectory, 'autostart')
    vi.mocked(application.getPath).mockImplementation((key: string) => {
      if (key === 'sys.appdata.autostart') return autostartDirectory
      if (key === 'app.exe_file') return '/opt/cherry-studio'
      return `/mock/${key}`
    })
    vi.stubEnv('APPIMAGE', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  })

  it('creates the Linux autostart file', async () => {
    await new AppService().setAppLaunchOnBoot(true)

    const desktopFile = path.join(autostartDirectory, 'cherry-studio.desktop')
    expect(fs.readFileSync(desktopFile, 'utf-8')).toContain('Exec=/opt/cherry-studio')
  })

  it('propagates Linux autostart write failures', async () => {
    vi.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('permission denied'))

    await expect(new AppService().setAppLaunchOnBoot(true)).rejects.toThrow('permission denied')
  })

  it('ignores a missing Linux autostart file when disabling', async () => {
    await expect(new AppService().setAppLaunchOnBoot(false)).resolves.toBeUndefined()
  })
})
