import { access, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  getAllDisplays: vi.fn(),
  getGpuFeatureStatus: vi.fn(),
  getGpuInfo: vi.fn(),
  showItemInFolder: vi.fn(),
  showSaveDialog: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getGPUFeatureStatus: electronMocks.getGpuFeatureStatus,
    getGPUInfo: electronMocks.getGpuInfo,
    getLocale: () => 'en-US',
    getName: () => 'Cherry Studio',
    getVersion: () => '2.0.0-test',
    isPackaged: true
  },
  dialog: { showSaveDialog: electronMocks.showSaveDialog },
  screen: { getAllDisplays: electronMocks.getAllDisplays },
  shell: { showItemInFolder: electronMocks.showItemInFolder }
}))

import { DiagnosticBundleService } from '../DiagnosticBundleService'

describe('DiagnosticBundleService', () => {
  let workDir: string
  let logsDir: string
  let tracesDir: string
  let crashDumpsDir: string
  let appTempDir: string
  let userDataDir: string
  let destination: string
  const parentWindow = {}
  const preferenceValues: Record<string, unknown> = {
    'app.developer_mode.enabled': true,
    'app.language': 'en-US',
    'app.proxy.mode': 'none',
    'BootConfig.app.disable_hardware_acceleration': false
  }
  const preferenceService = { get: vi.fn<(key: string) => unknown>() }

  beforeEach(async () => {
    vi.clearAllMocks()
    workDir = await mkdtemp(path.join(tmpdir(), 'diagnostic-service-'))
    logsDir = path.join(workDir, 'logs')
    tracesDir = path.join(workDir, 'traces')
    crashDumpsDir = path.join(workDir, 'crashes')
    appTempDir = path.join(workDir, 'temp')
    userDataDir = path.join(workDir, 'user-data')
    destination = path.join(workDir, 'bundle.zip')
    await Promise.all([mkdir(logsDir), mkdir(tracesDir), mkdir(crashDumpsDir), mkdir(appTempDir), mkdir(userDataDir)])
    preferenceService.get.mockImplementation((key) => preferenceValues[key])

    vi.mocked(application.getPath).mockImplementation((key: string, fileName?: string) => {
      const roots: Record<string, string> = {
        'app.crash_dumps': crashDumpsDir,
        'app.logs': logsDir,
        'app.temp': appTempDir,
        'app.userdata': userDataDir,
        'feature.trace': tracesDir
      }
      const root = roots[key] ?? workDir
      return fileName ? path.join(root, fileName) : root
    })
    vi.mocked(application.get).mockImplementation((name: string) => {
      if (name === 'PreferenceService') return preferenceService as never
      if (name === 'WindowManager') return { getWindow: () => parentWindow } as never
      throw new Error(`Unexpected service: ${name}`)
    })

    electronMocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination })
    electronMocks.getGpuInfo.mockResolvedValue({
      auxAttributes: {
        glRenderer: 'Test GPU',
        glVendor: 'Test Vendor',
        machineModelName: 'must-not-leak'
      },
      gpuDevice: [{ active: true, deviceId: 2, vendorId: 1 }]
    })
    electronMocks.getGpuFeatureStatus.mockReturnValue({ webgl: 'enabled' })
    electronMocks.getAllDisplays.mockReturnValue([
      { id: 99, label: 'Private display name', rotation: 0, scaleFactor: 2, size: { height: 900, width: 1440 } }
    ])
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  async function readZip(zipPath: string) {
    const zip = new StreamZip.async({ file: zipPath })
    try {
      const entries = Object.keys(await zip.entries()).sort()
      const contents: Record<string, Buffer> = {}
      for (const entry of entries) contents[entry] = await zip.entryData(entry)
      return { contents, entries }
    } finally {
      await zip.close()
    }
  }

  it('exports filtered logs, persisted traces, whitelisted system data, and crash inventory', async () => {
    const now = Date.now()
    const recentLog = `${JSON.stringify({ message: 'recent', timestamp: new Date(now - 1_000).toISOString() })}\n`
    const oldLog = `${JSON.stringify({ message: 'old', timestamp: new Date(now - 2 * 86_400_000).toISOString() })}\n`
    await writeFile(path.join(logsDir, 'app.2026-07-30.log'), `${oldLog}${recentLog}`)

    const topicDir = path.join(tracesDir, 'topic:private')
    await mkdir(topicDir)
    const traceLine = `${JSON.stringify({ id: 'span', startTime: now - 2_000, value: 'raw trace' })}\n`
    await writeFile(path.join(topicDir, 'trace*one'), traceLine)
    await writeFile(path.join(crashDumpsDir, 'private-crash-name.dmp'), 'dump')

    const service = new DiagnosticBundleService()
    const result = await service.exportBundle({ includeLogs: true, includeTraces: true, range: '24h' }, 'main-window')

    expect(result.status).toBe('saved')
    if (result.status !== 'saved') throw new Error('Expected saved result')
    expect(result.fileName).toBe('bundle.zip')
    expect(result.included.logs.fileCount).toBe(1)
    expect(result.included.traces.fileCount).toBe(1)

    const zip = await readZip(destination)
    expect(zip.entries).toHaveLength(3)
    expect(zip.entries).toContain('diagnostics.json')
    expect(zip.entries).toContain('logs/app.2026-07-30.log')
    expect(zip.entries.some((entry) => /^traces\/[0-9a-f]+\/[0-9a-f]+\.jsonl$/.test(entry))).toBe(true)
    expect(zip.entries.some((entry) => entry.endsWith('.dmp'))).toBe(false)
    expect(zip.contents['logs/app.2026-07-30.log'].toString()).toBe(recentLog)

    const manifestText = zip.contents['diagnostics.json'].toString()
    const manifest = JSON.parse(manifestText)
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.privacy).toEqual({
      containsUnredactedData: true,
      publiclyShareable: false,
      uploadedAutomatically: false
    })
    expect(manifest.crashDumps.files).toHaveLength(1)
    expect(manifest.system.gpu).toMatchObject({ renderer: 'Test GPU', vendor: 'Test Vendor' })
    expect(manifest.system.displays).toEqual([{ height: 900, rotation: 0, scaleFactor: 2, width: 1440 }])
    expect(manifestText).not.toContain('private-crash-name')
    expect(manifestText).not.toContain('Private display name')
    expect(manifestText).not.toContain('machineModelName')
    expect(manifestText).not.toContain('deviceId')
    expect(manifestText).not.toContain(userDataDir)

    expect(await service.revealLastBundle()).toBe(true)
    expect(electronMocks.showItemInFolder).toHaveBeenCalledWith(destination)
  })

  it('returns canceled without scanning or writing when the save dialog is canceled', async () => {
    electronMocks.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' })
    const service = new DiagnosticBundleService()

    await expect(
      service.exportBundle({ includeLogs: true, includeTraces: true, range: '24h' }, 'main-window')
    ).resolves.toEqual({ status: 'canceled' })
    expect(await service.revealLastBundle()).toBe(false)
  })

  it('exports only the manifest when logs and traces are disabled', async () => {
    const service = new DiagnosticBundleService()

    const result = await service.exportBundle({ includeLogs: false, includeTraces: false, range: '24h' }, 'main-window')

    expect(result.status).toBe('saved')
    const zip = await readZip(destination)
    expect(zip.entries).toEqual(['diagnostics.json'])
    const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
    expect(manifest.selection).toMatchObject({
      includeLogs: false,
      includeSystemInformation: true,
      includeTraces: false
    })
    expect(manifest.privacy.containsUnredactedData).toBe(false)
  })

  it('uses the main-process clock after the save dialog closes', async () => {
    const exportStartedAt = new Date('2026-07-30T00:15:00.000Z')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(exportStartedAt.getTime())
    const service = new DiagnosticBundleService()

    try {
      await service.exportBundle({ includeLogs: false, includeTraces: false, range: '24h' }, 'main-window')
    } finally {
      clock.mockRestore()
    }

    const zip = await readZip(destination)
    const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
    expect(manifest.createdAt).toBe(exportStartedAt.toISOString())
    expect(manifest.range.to).toBe(exportStartedAt.toISOString())
  })

  it('continues when individual system information sources fail', async () => {
    electronMocks.getGpuInfo.mockRejectedValueOnce(new Error('gpu unavailable'))
    electronMocks.getGpuFeatureStatus.mockImplementationOnce(() => {
      throw new Error('features unavailable')
    })
    electronMocks.getAllDisplays.mockImplementationOnce(() => {
      throw new Error('displays unavailable')
    })
    preferenceService.get.mockImplementation((key) => {
      if (key === 'app.developer_mode.enabled') throw new Error('preference unavailable')
      return preferenceValues[key]
    })
    const service = new DiagnosticBundleService()

    const result = await service.exportBundle({ includeLogs: false, includeTraces: false, range: '24h' }, 'main-window')

    expect(result.status).toBe('saved')
    if (result.status !== 'saved') throw new Error('Expected saved result')
    expect(result.warnings).toContain('system_info_unavailable')
    const zip = await readZip(destination)
    const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
    expect(manifest.system.application.version).toBe('2.0.0-test')
    expect(manifest.system.gpu).toBeUndefined()
    expect(manifest.system.displays).toBeUndefined()
    expect(manifest.system.settings.developerModeEnabled).toBeUndefined()
  })

  it('returns busy while another save dialog is open', async () => {
    let resolveDialog: (value: { canceled: boolean; filePath: string }) => void = () => undefined
    electronMocks.showSaveDialog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDialog = resolve
        })
    )
    const service = new DiagnosticBundleService()
    const first = service.exportBundle({ includeLogs: false, includeTraces: false, range: '24h' }, 'main-window')

    await expect(
      service.exportBundle({ includeLogs: false, includeTraces: false, range: '24h' }, 'main-window')
    ).resolves.toEqual({ status: 'busy' })
    resolveDialog({ canceled: true, filePath: '' })
    await expect(first).resolves.toEqual({ status: 'canceled' })
  })

  it('refuses to save a bundle inside a diagnostic source directory', async () => {
    electronMocks.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(logsDir, 'diagnostics.zip')
    })
    const service = new DiagnosticBundleService()

    await expect(
      service.exportBundle({ includeLogs: false, includeTraces: false, range: '24h' }, 'main-window')
    ).rejects.toThrow('destination cannot be inside')
  })

  it('refuses to save through a directory symlink into a diagnostic source directory', async () => {
    const linkedCrashDumps = path.join(workDir, 'linked-crashes')
    await symlink(crashDumpsDir, linkedCrashDumps, process.platform === 'win32' ? 'junction' : 'dir')
    electronMocks.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(linkedCrashDumps, 'diagnostics.zip')
    })
    const service = new DiagnosticBundleService()

    await expect(
      service.exportBundle({ includeLogs: false, includeTraces: false, range: '24h' }, 'main-window')
    ).rejects.toThrow('destination cannot be inside')
    await expect(access(path.join(crashDumpsDir, 'diagnostics.zip'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('cleans staged and atomic temporary files when the destination cannot be written', async () => {
    destination = path.join(workDir, 'missing-parent', 'bundle.zip')
    electronMocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: destination })
    const service = new DiagnosticBundleService()

    await expect(
      service.exportBundle({ includeLogs: false, includeTraces: false, range: '24h' }, 'main-window')
    ).rejects.toThrow()

    expect(await readdir(appTempDir)).toEqual([])
    await expect(access(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
