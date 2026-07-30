import { access, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { ZipArchive } from 'archiver'
import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
  getVersion: vi.fn(),
  showSaveDialog: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getLocale: electronMocks.getLocale,
    getName: () => 'Cherry Studio',
    getVersion: electronMocks.getVersion,
    isPackaged: true
  },
  dialog: { showSaveDialog: electronMocks.showSaveDialog }
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
  const preferenceService = { get: vi.fn(() => 'en-US') }

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
    electronMocks.getLocale.mockReturnValue('en-US')
    electronMocks.getVersion.mockReturnValue('2.0.0-test')
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
    expect(result.filePath).toBe(destination)
    expect(result.hasWarnings).toBe(false)
    expect(result.includedFileCount).toBe(2)
    expect(result.omittedFileCount).toBe(0)

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
    expect(manifest.system.application).toEqual({
      isPackaged: true,
      name: 'Cherry Studio',
      version: '2.0.0-test'
    })
    expect(manifest.system.operatingSystem).toMatchObject({ locale: 'en-US' })
    expect(manifestText).not.toContain('private-crash-name')
    expect(manifestText).not.toContain(userDataDir)
  })

  it('returns canceled without scanning or writing when the save dialog is canceled', async () => {
    electronMocks.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' })
    const service = new DiagnosticBundleService()

    await expect(
      service.exportBundle({ includeLogs: true, includeTraces: true, range: '24h' }, 'main-window')
    ).resolves.toEqual({ status: 'canceled' })
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

  it('continues when application metadata collection fails', async () => {
    electronMocks.getVersion.mockImplementation(() => {
      throw new Error('version unavailable')
    })
    const service = new DiagnosticBundleService()

    const result = await service.exportBundle({ includeLogs: false, includeTraces: false, range: '24h' }, 'main-window')

    expect(result.status).toBe('saved')
    if (result.status !== 'saved') throw new Error('Expected saved result')
    expect(result.hasWarnings).toBe(true)
    const zip = await readZip(destination)
    const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
    expect(manifest.system.application).toBeUndefined()
    expect(manifest.system.operatingSystem.locale).toBe('en-US')
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

  it('preserves a destination created while the bundle archive is finalizing', async () => {
    const originalFinalize = ZipArchive.prototype.finalize
    const finalizeSpy = vi.spyOn(ZipArchive.prototype, 'finalize').mockImplementation(async function (
      this: ZipArchive
    ) {
      const finalized = originalFinalize.call(this)
      await writeFile(destination, 'external file')
      return finalized
    })
    const service = new DiagnosticBundleService()

    try {
      await expect(
        service.exportBundle({ includeLogs: false, includeTraces: false, range: '24h' }, 'main-window')
      ).rejects.toThrow('destination changed')
    } finally {
      finalizeSpy.mockRestore()
    }

    expect(await readFile(destination, 'utf8')).toBe('external file')
    expect((await readdir(workDir)).filter((name) => name.startsWith('.cherry-studio-diagnostics-'))).toEqual([])
    expect(await readdir(appTempDir)).toEqual([])
  })
})
