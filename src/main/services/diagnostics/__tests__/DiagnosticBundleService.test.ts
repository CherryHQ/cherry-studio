import { createHash } from 'node:crypto'
import { access, link, mkdir, mkdtemp, readdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { diagnosticsErrorCodes } from '@shared/ipc/errors/diagnostics'
import { ZipArchive } from 'archiver'
import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
  getVersion: vi.fn(),
  showSaveDialog: vi.fn()
}))

const uploadMocks = vi.hoisted(() => ({
  upload: vi.fn()
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

vi.mock('../CherryDiagnosticUploadClient', () => ({
  cherryDiagnosticUploadClient: uploadMocks
}))

import { DiagnosticBundleService } from '../DiagnosticBundleService'

const REPORT_ID = 'opaque-report-id'
const RETRY_REPORT_ID = 'opaque-retry-report-id'
const UPLOAD_INPUT = {
  description: '  Line one\nLine two  ',
  includeLogs: false,
  includeTraces: false,
  range: '24h' as const
}

function formatLogDate(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

describe('DiagnosticBundleService', () => {
  let workDir: string
  let logsDir: string
  let tracesDir: string
  let crashDumpsDir: string
  let appTempDir: string
  let userDataDir: string
  let downloadsDir: string
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
    downloadsDir = path.join(workDir, 'downloads')
    destination = path.join(workDir, 'bundle.zip')
    await Promise.all([
      mkdir(logsDir),
      mkdir(tracesDir),
      mkdir(crashDumpsDir),
      mkdir(appTempDir),
      mkdir(userDataDir),
      mkdir(downloadsDir)
    ])

    vi.mocked(application.getPath).mockImplementation((key: string, fileName?: string) => {
      const roots: Record<string, string> = {
        'app.crash_dumps': crashDumpsDir,
        'app.logs': logsDir,
        'app.temp': appTempDir,
        'app.userdata': userDataDir,
        'feature.trace': tracesDir,
        'sys.downloads': downloadsDir
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
    uploadMocks.upload.mockResolvedValue({ reportId: REPORT_ID, status: 'uploaded' })
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

  async function sha256(filePath: string): Promise<string> {
    return createHash('sha256')
      .update(await readFile(filePath))
      .digest('hex')
  }

  it('exports filtered logs, persisted traces, whitelisted system data, and crash inventory', async () => {
    const now = Date.now()
    const logFileName = `app.${formatLogDate(now)}.log`
    const recentLog = `${JSON.stringify({ message: 'recent', timestamp: new Date(now - 1_000).toISOString() })}\n`
    const oldLog = `${JSON.stringify({ message: 'old', timestamp: new Date(now - 2 * 86_400_000).toISOString() })}\n`
    await writeFile(path.join(logsDir, logFileName), `${oldLog}${recentLog}`)

    // `:` and `*` exercise archive-name sanitisation but are unwriteable on Windows.
    const isWin = process.platform === 'win32'
    const topicDir = path.join(tracesDir, isWin ? 'topic-private' : 'topic:private')
    await mkdir(topicDir)
    const traceLine = `${JSON.stringify({ id: 'span', startTime: now - 2_000, value: 'raw trace' })}\n`
    await writeFile(path.join(topicDir, isWin ? 'trace-one' : 'trace*one'), traceLine)
    // The inventory filters by mtime against a range the service closes at its own Date.now(),
    // which Windows can read a few ms behind the clock the filesystem stamped the file with.
    const crashDumpPath = path.join(crashDumpsDir, 'private-crash-name.dmp')
    await writeFile(crashDumpPath, 'dump')
    await utimes(crashDumpPath, new Date(now - 1_000), new Date(now - 1_000))

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
    expect(zip.entries).toContain(`logs/${logFileName}`)
    expect(zip.entries.some((entry) => /^traces\/[0-9a-f]+\/[0-9a-f]+\.jsonl$/.test(entry))).toBe(true)
    expect(zip.entries.some((entry) => entry.endsWith('.dmp'))).toBe(false)
    expect(zip.contents[`logs/${logFileName}`].toString()).toBe(recentLog)

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
    await Promise.all([rm(logsDir, { recursive: true }), rm(tracesDir, { recursive: true })])
    await Promise.all([writeFile(logsDir, 'not a directory'), writeFile(tracesDir, 'not a directory')])
    const service = new DiagnosticBundleService()

    const result = await service.exportBundle({ includeLogs: false, includeTraces: false, range: '24h' }, 'main-window')

    expect(result.status).toBe('saved')
    if (result.status !== 'saved') throw new Error('Expected saved result')
    expect(result.hasWarnings).toBe(false)
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

  it('uploads a bundle with the normalized description and returns the opaque report id unchanged', async () => {
    let uploadedManifest: Record<string, unknown> | undefined
    uploadMocks.upload.mockImplementationOnce(async ({ description, fileName, filePath: uploadPath }) => {
      const zip = await readZip(uploadPath)
      uploadedManifest = JSON.parse(zip.contents['diagnostics.json'].toString())
      expect(description).toBe('Line one\r\nLine two')
      expect(fileName).toBe(path.basename(uploadPath))
      return { reportId: REPORT_ID, status: 'uploaded' }
    })
    const service = new DiagnosticBundleService()

    const result = await service.uploadBundle(UPLOAD_INPUT)

    expect(result).toEqual({ reportId: REPORT_ID, status: 'uploaded' })
    expect(uploadedManifest?.privacy).toMatchObject({ uploadedAutomatically: true })
    expect(await readdir(appTempDir)).toEqual([])
    expect(await readdir(downloadsDir)).toEqual([])
  })

  it('preserves a failed upload in Downloads with a unique bundle filename', async () => {
    uploadMocks.upload.mockResolvedValueOnce({
      reason: 'rate_limited',
      status: 'rejected'
    })
    const service = new DiagnosticBundleService()

    const result = await service.uploadBundle(UPLOAD_INPUT)

    if (result.status !== 'submission_failed') throw new Error('Expected preserved failed submission')
    expect(result).toEqual({
      bundleId: expect.any(String),
      fileName: expect.any(String),
      filePath: expect.any(String),
      reason: 'rate_limited',
      status: 'submission_failed'
    })
    expect(path.dirname(result.filePath)).toBe(downloadsDir)
    expect(result.fileName).toMatch(
      /^cherry-studio-diagnostics-\d{8}-\d{6}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.zip$/
    )
    const zip = await readZip(result.filePath)
    const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
    expect(manifest.privacy.uploadedAutomatically).toBe(true)
    expect(await readdir(appTempDir)).toEqual([])
  })

  it('preserves the bundle without retrying when submission status is unknown', async () => {
    uploadMocks.upload.mockResolvedValueOnce({ status: 'submission_unknown' })
    const service = new DiagnosticBundleService()

    const result = await service.uploadBundle(UPLOAD_INPUT)

    if (result.status !== 'submission_unknown') throw new Error('Expected unknown submission status')
    expect(result).toEqual({
      bundleId: expect.any(String),
      fileName: expect.any(String),
      filePath: expect.any(String),
      status: 'submission_unknown'
    })
    await expect(access(result.filePath)).resolves.toBeUndefined()
    expect(uploadMocks.upload).toHaveBeenCalledOnce()
  })

  it('retries the same saved archive and removes the retry record after success', async () => {
    const fileSha256 = 'a'.repeat(64)
    uploadMocks.upload
      .mockResolvedValueOnce({ fileSha256, reason: 'service_unavailable', status: 'rejected' })
      .mockResolvedValueOnce({ reason: 'rate_limited', status: 'rejected' })
      .mockResolvedValueOnce({ reportId: RETRY_REPORT_ID, status: 'uploaded' })
    const service = new DiagnosticBundleService()

    const first = await service.uploadBundle(UPLOAD_INPUT)
    if (first.status !== 'submission_failed') throw new Error('Expected preserved failed submission')
    const originalArchive = await readFile(first.filePath)
    await rm(appTempDir, { recursive: true })
    await writeFile(appTempDir, 'retry must not rebuild')

    const retryFailed = await service.retryUpload({ bundleId: first.bundleId })
    const retried = await service.retryUpload({ bundleId: first.bundleId })

    expect(retryFailed).toEqual({
      bundleId: first.bundleId,
      fileName: first.fileName,
      filePath: first.filePath,
      reason: 'rate_limited',
      status: 'submission_failed'
    })
    expect(retried).toEqual({ reportId: RETRY_REPORT_ID, status: 'uploaded' })
    expect(uploadMocks.upload).toHaveBeenNthCalledWith(1, {
      description: 'Line one\r\nLine two',
      fileName: first.fileName,
      filePath: expect.stringContaining(`${path.sep}temp${path.sep}`)
    })
    expect(uploadMocks.upload).toHaveBeenNthCalledWith(2, {
      description: 'Line one\r\nLine two',
      expectedFileSha256: fileSha256,
      fileName: first.fileName,
      filePath: first.filePath
    })
    expect(uploadMocks.upload).toHaveBeenNthCalledWith(3, {
      description: 'Line one\r\nLine two',
      expectedFileSha256: fileSha256,
      fileName: first.fileName,
      filePath: first.filePath
    })
    await expect(readFile(first.filePath)).resolves.toEqual(originalArchive)
    await expect(service.retryUpload({ bundleId: first.bundleId })).rejects.toMatchObject({
      code: diagnosticsErrorCodes.RETRY_NOT_AVAILABLE
    })
  })

  it('rejects a retry when the saved archive no longer matches the initially uploaded content', async () => {
    uploadMocks.upload.mockImplementation(async (input: { expectedFileSha256?: string; filePath: string }) => {
      const fileSha256 = await sha256(input.filePath)
      if (!input.expectedFileSha256) {
        return { fileSha256, reason: 'service_unavailable', status: 'rejected' }
      }
      if (fileSha256 !== input.expectedFileSha256) {
        return { reason: 'invalid_archive', status: 'rejected' }
      }
      return { reportId: RETRY_REPORT_ID, status: 'uploaded' }
    })
    const service = new DiagnosticBundleService()

    const first = await service.uploadBundle(UPLOAD_INPUT)
    if (first.status !== 'submission_failed') throw new Error('Expected preserved failed submission')
    await writeFile(first.filePath, 'replacement archive')

    await expect(service.retryUpload({ bundleId: first.bundleId })).resolves.toEqual({
      bundleId: first.bundleId,
      fileName: first.fileName,
      filePath: first.filePath,
      reason: 'invalid_archive',
      status: 'submission_failed'
    })
  })

  it('rejects a retry id that is not owned by this process', async () => {
    const service = new DiagnosticBundleService()

    await expect(service.retryUpload({ bundleId: '323e4567-e89b-42d3-a456-426614174000' })).rejects.toMatchObject({
      code: diagnosticsErrorCodes.RETRY_NOT_AVAILABLE
    })
    expect(uploadMocks.upload).not.toHaveBeenCalled()
  })

  it('serializes export, initial upload, and retry through one in-flight operation', async () => {
    let resolveUpload: (value: { reportId: string; status: 'uploaded' }) => void = () => undefined
    uploadMocks.upload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve
        })
    )
    const service = new DiagnosticBundleService()
    const first = service.uploadBundle(UPLOAD_INPUT)

    await vi.waitFor(() => expect(uploadMocks.upload).toHaveBeenCalledOnce())
    await expect(
      service.exportBundle({ includeLogs: false, includeTraces: false, range: '24h' }, 'main-window')
    ).resolves.toEqual({ status: 'busy' })
    await expect(service.retryUpload({ bundleId: '423e4567-e89b-42d3-a456-426614174000' })).resolves.toEqual({
      status: 'busy'
    })
    resolveUpload({ reportId: REPORT_ID, status: 'uploaded' })
    await expect(first).resolves.toMatchObject({ status: 'uploaded' })
  })

  it('uses a stable diagnostics error when upload bundle construction fails', async () => {
    await rm(appTempDir, { recursive: true })
    await writeFile(appTempDir, 'not a directory')
    const service = new DiagnosticBundleService()

    await expect(service.uploadBundle(UPLOAD_INPUT)).rejects.toMatchObject({
      code: diagnosticsErrorCodes.BUNDLE_BUILD_FAILED
    })
    expect(uploadMocks.upload).not.toHaveBeenCalled()
  })

  it('uses a stable diagnostics error when a failed upload cannot be preserved', async () => {
    uploadMocks.upload.mockResolvedValueOnce({
      reason: 'service_unavailable',
      status: 'rejected'
    })
    await rm(downloadsDir, { recursive: true })
    const service = new DiagnosticBundleService()

    await expect(service.uploadBundle(UPLOAD_INPUT)).rejects.toMatchObject({
      code: diagnosticsErrorCodes.FALLBACK_SAVE_FAILED
    })
    expect(await readdir(appTempDir)).toEqual([])
  })

  it('uses a distinct stable error when an uncertain submission cannot be preserved', async () => {
    uploadMocks.upload.mockResolvedValueOnce({ status: 'submission_unknown' })
    await rm(downloadsDir, { recursive: true })
    const service = new DiagnosticBundleService()

    await expect(service.uploadBundle(UPLOAD_INPUT)).rejects.toMatchObject({
      code: diagnosticsErrorCodes.SUBMISSION_UNKNOWN_FALLBACK_SAVE_FAILED
    })
    expect(uploadMocks.upload).toHaveBeenCalledOnce()
    expect(await readdir(appTempDir)).toEqual([])
  })

  it('refuses to save a bundle inside a diagnostic source directory', async () => {
    electronMocks.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(logsDir, 'diagnostics.zip')
    })
    const service = new DiagnosticBundleService()

    await expect(
      service.exportBundle({ includeLogs: false, includeTraces: false, range: '24h' }, 'main-window')
    ).rejects.toMatchObject({ code: diagnosticsErrorCodes.DESTINATION_INSIDE_SOURCE })
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
    ).rejects.toMatchObject({ code: diagnosticsErrorCodes.DESTINATION_INSIDE_SOURCE })
    await expect(access(path.join(crashDumpsDir, 'diagnostics.zip'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to overwrite a destination that is the same physical file as a selected source', async () => {
    const now = Date.now()
    const source = path.join(logsDir, `app.${formatLogDate(now)}.log`)
    await writeFile(source, `${JSON.stringify({ timestamp: new Date(now - 1_000).toISOString() })}\n`)
    await link(source, destination)
    const service = new DiagnosticBundleService()

    await expect(
      service.exportBundle({ includeLogs: true, includeTraces: false, range: '24h' }, 'main-window')
    ).rejects.toMatchObject({ code: diagnosticsErrorCodes.DESTINATION_IS_SOURCE })
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
