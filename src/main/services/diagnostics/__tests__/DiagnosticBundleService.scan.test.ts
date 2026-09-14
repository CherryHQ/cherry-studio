import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import type * as ScanModule from '../scan'

const electronMocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
  getVersion: vi.fn(),
  showSaveDialog: vi.fn()
}))

const scanMocks = vi.hoisted(() => ({ collectFails: false }))

vi.mock('electron', () => ({
  app: {
    getLocale: electronMocks.getLocale,
    getName: () => 'Cherry Studio',
    getVersion: electronMocks.getVersion,
    isPackaged: true
  },
  dialog: { showSaveDialog: electronMocks.showSaveDialog }
}))

vi.mock('../scan', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ScanModule
  return {
    ...actual,
    collectErrorLogRecords: (...args: Parameters<typeof actual.collectErrorLogRecords>) => {
      if (scanMocks.collectFails) throw new Error('scan exploded')
      return actual.collectErrorLogRecords(...args)
    }
  }
})

import { DiagnosticBundleService } from '../DiagnosticBundleService'

function localTimestamp(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

function errorLogFileName(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `app-error.${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.log`
}

describe('DiagnosticBundleService scan report', () => {
  let workDir: string
  let logsDir: string
  let destination: string

  beforeEach(async () => {
    vi.clearAllMocks()
    scanMocks.collectFails = false
    workDir = await mkdtemp(path.join(tmpdir(), 'diagnostic-scan-'))
    logsDir = path.join(workDir, 'logs')
    destination = path.join(workDir, 'bundle.zip')
    await Promise.all([
      mkdir(logsDir),
      mkdir(path.join(workDir, 'traces')),
      mkdir(path.join(workDir, 'crashes')),
      mkdir(path.join(workDir, 'temp'))
    ])

    vi.mocked(application.getPath).mockImplementation((key: string, fileName?: string) => {
      const roots: Record<string, string> = {
        'app.crash_dumps': path.join(workDir, 'crashes'),
        'app.logs': logsDir,
        'app.temp': path.join(workDir, 'temp'),
        'feature.trace': path.join(workDir, 'traces')
      }
      const root = roots[key] ?? workDir
      return fileName ? path.join(root, fileName) : root
    })
    vi.mocked(application.get).mockImplementation((name: string) => {
      if (name === 'PreferenceService') return { get: vi.fn(() => 'en-US') } as never
      if (name === 'WindowManager') return { getWindow: () => ({}) } as never
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

  it('ships a findings report matching known errors from the error logs', async () => {
    const now = Date.now()
    const line = `${JSON.stringify({
      timestamp: localTimestamp(now - 60_000),
      level: 'error',
      message: 'Provider request failed with status 401 Unauthorized: invalid api key provided',
      module: 'AiStreamManager',
      process: 'main'
    })}\n`
    await writeFile(path.join(logsDir, errorLogFileName(now)), line)
    const service = new DiagnosticBundleService()

    const result = await service.exportBundle(
      { includeChatRecords: false, includeLogs: true, includeTraces: false, range: '24h' },
      'main-window'
    )

    expect(result.status).toBe('saved')
    const zip = await readZip(destination)
    expect(zip.entries).toContain('scan/findings.json')
    const report = JSON.parse(zip.contents['scan/findings.json'].toString())
    expect(report.schemaVersion).toBe(1)
    expect(report.scannedRecordCount).toBe(1)
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]).toMatchObject({
      ruleId: 'provider-auth-rejected',
      domain: 'provider',
      attribution: 'user-fixable',
      count: 1
    })
    const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
    // completeness must be readable from the manifest alone, without opening the inner report
    expect(manifest.scan).toEqual({ status: 'included', findingCount: 1, truncated: false, skippedFileCount: 0 })
  })

  it('omits the report entirely when logs are excluded', async () => {
    const service = new DiagnosticBundleService()

    const result = await service.exportBundle(
      { includeChatRecords: false, includeLogs: false, includeTraces: false, range: '24h' },
      'main-window'
    )

    expect(result.status).toBe('saved')
    const zip = await readZip(destination)
    expect(zip.entries).toEqual(['diagnostics.json'])
    const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
    expect(manifest.scan).toEqual({ status: 'skipped' })
  })

  it('marks the scan failed when the logs directory cannot be read', async () => {
    // the real readdir path, not a mocked throw: it used to return an empty scan, so the
    // manifest advertised a clean `included, 0 findings` bundle over a scan that never ran
    await rm(logsDir, { recursive: true, force: true })
    const service = new DiagnosticBundleService()

    const result = await service.exportBundle(
      { includeChatRecords: false, includeLogs: true, includeTraces: false, range: '24h' },
      'main-window'
    )

    expect(result.status).toBe('saved')
    const zip = await readZip(destination)
    expect(zip.entries).not.toContain('scan/findings.json')
    const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
    expect(manifest.scan).toEqual({ status: 'failed' })
    expect(manifest.warnings).toContain('scan_failed')
  })

  it('still exports the bundle when the scan itself fails', async () => {
    scanMocks.collectFails = true
    const service = new DiagnosticBundleService()

    const result = await service.exportBundle(
      { includeChatRecords: false, includeLogs: true, includeTraces: false, range: '24h' },
      'main-window'
    )

    expect(result.status).toBe('saved')
    if (result.status !== 'saved') throw new Error('Expected saved result')
    expect(result.hasWarnings).toBe(true)
    const zip = await readZip(destination)
    expect(zip.entries).not.toContain('scan/findings.json')
    const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
    expect(manifest.scan).toEqual({ status: 'failed' })
    expect(manifest.warnings).toContain('scan_failed')
  })
})
