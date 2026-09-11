import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { vi } from 'vitest'

const { execFileSync, spawn } = vi.hoisted(() => ({ execFileSync: vi.fn(), spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync, spawn }))

import { launchApp } from '../lifecycle'
import { ensureRunDirectories, getRunPaths } from '../paths'

it('starts Windows installers with both owned inspector and renderer CDP ports', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-launch-'))
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  writeFileSync(paths.installation, JSON.stringify({ executablePath: 'C:\\Cherry\\Cherry Studio.exe' }))
  let launched = false
  execFileSync.mockImplementation(() => (launched ? '42001' : ''))
  spawn.mockImplementation(() => {
    launched = true
    return { pid: 42001, unref() {} }
  })
  vi.spyOn(process, 'kill').mockReturnValue(true)
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    json: async () => [
      {
        type: 'page',
        title: 'Cherry Studio',
        url: 'file:///C:/Cherry/resources/app.asar/out/renderer/windows/main/index.html'
      }
    ]
  }))
  try {
    const record = await launchApp(paths, {
      mode: 'tag',
      platform: 'windows',
      profile: 'authenticated',
      targetRoot: directory,
      runKey: 'test'
    })
    expect(record.electronPid).toBe(42001)
    expect(spawn.mock.calls[0][1]).toEqual([
      '--inspect=9229',
      '--remote-debugging-port=9222',
      `--user-data-dir=${join(paths.profiles, 'authenticated')}`
    ])
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    rmSync(directory, { recursive: true, force: true })
  }
})
