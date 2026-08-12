import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { translateErrorCodes } from '@shared/ipc/errors/translate'
import type { AbsoluteFilePath } from '@shared/types/file'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appGet: vi.fn(),
  createFileTx: vi.fn(),
  getBinaryPath: vi.fn(),
  modelGetByKey: vi.fn(),
  notifyDataApiDataChange: vi.fn(),
  spawn: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: mocks.appGet,
    getPath: vi.fn((key: string, filename?: string) => {
      if (key === 'feature.pdf_translation.temp') return filename ? path.join(TEST_ROOT, filename) : TEST_ROOT
      if (key === 'feature.pdf_translation.babeldoc') return path.join(TEST_ROOT, 'runtime')
      if (key === 'feature.binary.data') return path.join(TEST_ROOT, 'binary')
      throw new Error(`Unexpected path key: ${key}`)
    })
  }
}))

vi.mock('@data/services/ModelService', () => ({ modelService: { getByKey: mocks.modelGetByKey } }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: mocks.notifyDataApiDataChange }))
vi.mock('@data/services/TranslateHistoryService', () => ({
  translateHistoryService: { createFileTx: mocks.createFileTx }
}))
vi.mock('@main/utils/binaryResolver', () => ({ getBinaryPath: mocks.getBinaryPath }))
vi.mock('@main/utils/processRunner', () => ({
  crossPlatformSpawn: mocks.spawn,
  killProcessTree: (child: { kill: () => void }) => child.kill()
}))
vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: vi.fn(() => Promise.resolve({ OPENAI_API_KEY: 'shell-secret', PATH: '/usr/bin' }))
}))
vi.mock('@main/core/lifecycle', () => {
  class BaseService {}
  return {
    BaseService,
    DependsOn: () => (target: unknown) => target,
    Injectable: () => (target: unknown) => target,
    Phase: { WhenReady: 'whenReady' },
    ServicePhase: () => (target: unknown) => target
  }
})

const TEST_ROOT = path.join(os.tmpdir(), 'cherry-pdf-translation-service-test')
const SOURCE_PATH = path.join(TEST_ROOT, 'source', 'research paper.pdf') as AbsoluteFilePath
const MANAGED_BINARY = path.join(TEST_ROOT, 'managed', 'babeldoc-stream')
const TRANSLATED_ENTRY_ID = '019606a0-0000-7000-8000-000000000001'
const SOURCE_ENTRY_ID = '019606a0-0000-7000-8000-000000000002'
const HISTORY_ID = '019606a0-0000-7000-8000-000000000003'
/** Where `getPhysicalPath` puts an internal entry — `{userData}/Data/Files/{id}.{ext}` in production. */
const managedPath = (id: string) => path.join(TEST_ROOT, 'files', `${id}.pdf`)

const binaryManager = { getToolSnapshots: vi.fn() }
const apiGateway = {
  acquireLease: vi.fn(),
  ensureValidApiKey: vi.fn(),
  getCurrentConfig: vi.fn(),
  releaseLease: vi.fn()
}
const fileManager = {
  createInternalEntry: vi.fn(),
  ensureExternalEntry: vi.fn(),
  getPhysicalPath: vi.fn(),
  permanentDelete: vi.fn(),
  rename: vi.fn()
}
const tx = Symbol('tx')
const dbService = { withWriteTx: vi.fn() }
const streamEvent = (event: Record<string, unknown>) =>
  `${JSON.stringify({ schema: 'babeldoc-stream/v2', ...event })}\n`
const finishEvent = () =>
  streamEvent({
    type: 'finish',
    result: {
      original_pdf_path: SOURCE_PATH,
      mono_pdf_path: null,
      dual_pdf_path: null,
      total_seconds: 1
    }
  })

const { PdfTranslationService } = await import('../PdfTranslationService')

describe('PdfTranslationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fs.rmSync(TEST_ROOT, { force: true, recursive: true })
    fs.mkdirSync(path.dirname(SOURCE_PATH), { recursive: true })
    fs.writeFileSync(SOURCE_PATH, '%PDF-test')
    fs.mkdirSync(path.dirname(MANAGED_BINARY), { recursive: true })
    fs.writeFileSync(MANAGED_BINARY, '#!/bin/sh')
    fs.chmodSync(MANAGED_BINARY, 0o755)

    mocks.appGet.mockImplementation((name: string) => {
      if (name === 'BinaryManager') return binaryManager
      if (name === 'ApiGatewayService') return apiGateway
      if (name === 'FileManager') return fileManager
      if (name === 'DbService') return dbService
      throw new Error(`Unexpected service: ${name}`)
    })
    // The entry inherits BabelDOC's noisy basename, then `rename` trades it for the display name.
    fileManager.createInternalEntry.mockImplementation(({ path: artifact }: { path: string }) =>
      Promise.resolve({ id: TRANSLATED_ENTRY_ID, name: path.parse(artifact).name, ext: 'pdf' })
    )
    fileManager.rename.mockImplementation((id: string, newName: string) =>
      Promise.resolve({ id, name: newName, ext: 'pdf' })
    )
    fileManager.ensureExternalEntry.mockResolvedValue({ id: SOURCE_ENTRY_ID, name: 'research paper', ext: 'pdf' })
    fileManager.getPhysicalPath.mockImplementation(managedPath)
    fileManager.permanentDelete.mockResolvedValue(undefined)
    dbService.withWriteTx.mockImplementation((fn: (handle: unknown) => unknown) => fn(tx))
    mocks.createFileTx.mockReturnValue({ id: HISTORY_ID })
    mocks.getBinaryPath.mockResolvedValue(MANAGED_BINARY)
    mocks.modelGetByKey.mockReturnValue({
      id: 'openai::gpt-4.1-internal',
      providerId: 'openai',
      apiModelId: 'gpt-4.1',
      capabilities: [],
      isEnabled: true,
      name: 'GPT-4.1'
    })
    binaryManager.getToolSnapshots.mockResolvedValue({
      'babeldoc-stream': {
        name: 'babeldoc-stream',
        availability: { source: 'mise', path: MANAGED_BINARY },
        application: { status: 'applied', version: '0.6.4.post2' }
      }
    })
    apiGateway.acquireLease.mockResolvedValue(undefined)
    apiGateway.ensureValidApiKey.mockResolvedValue('cs-sk-test')
    apiGateway.getCurrentConfig.mockReturnValue({ host: '127.0.0.1', port: 23333 })

    mocks.spawn.mockImplementation((_command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stderr: PassThrough
        stdout: PassThrough
        kill: ReturnType<typeof vi.fn>
      }
      child.stderr = new PassThrough()
      child.stdout = new PassThrough()
      child.kill = vi.fn()

      const outputDir = args[args.indexOf('--output') + 1]
      fs.mkdirSync(outputDir, { recursive: true })
      const targetLanguage = args[args.indexOf('--lang-out') + 1]
      fs.writeFileSync(path.join(outputDir, `research paper.no_watermark.${targetLanguage}.mono.pdf`), '%PDF-mono')
      queueMicrotask(() => {
        child.stdout.write(finishEvent())
        child.stdout.end()
        child.emit('close', 0, null)
      })
      return child
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(TEST_ROOT, { force: true, recursive: true })
  })

  it('uses the manually installed BabelDOC, routes the selected model through Cherry Gateway, and returns the translated PDF', async () => {
    const service = new PdfTranslationService()

    const result = await service.translate({
      jobId: 'job-1',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    })

    expect(binaryManager.getToolSnapshots).toHaveBeenCalledTimes(1)
    expect(apiGateway.acquireLease).toHaveBeenCalledTimes(1)
    expect(apiGateway.releaseLease).toHaveBeenCalledTimes(1)
    expect(mocks.spawn).toHaveBeenCalledWith(
      MANAGED_BINARY,
      expect.arrayContaining([
        SOURCE_PATH,
        '--files',
        '--openai',
        '--openai-model',
        'openai:gpt-4.1',
        '--openai-base-url',
        'http://127.0.0.1:23333/v1',
        '--lang-in',
        'en-US',
        '--lang-out',
        'zh-CN',
        '--progress-json',
        '--progress-json-version',
        '2',
        '--watermark-output-mode',
        'no_watermark',
        '--no-dual'
      ]),
      expect.objectContaining({
        cwd: expect.stringContaining('job-1'),
        // POSIX runs BabelDOC as its own process-group leader so the whole tree can be reaped.
        detached: process.platform !== 'win32',
        env: expect.not.objectContaining({ OPENAI_API_KEY: 'shell-secret' })
      })
    )
    expect(mocks.spawn.mock.calls[0][2].env).toEqual(
      expect.objectContaining({ HOME: expect.stringContaining('runtime') })
    )
    expect(mocks.spawn.mock.calls[0][2].env).not.toHaveProperty('PYTHONPATH')
    const args = mocks.spawn.mock.calls[0][1] as string[]
    expect(args).not.toContain('--no-mono')
    expect(args).not.toContain('--auto-enable-ocr-workaround')
    const configPath = args[args.indexOf('--config') + 1]
    expect(configPath).toContain('job-1')
    expect(args).not.toContain('cs-sk-test')
    expect(fs.existsSync(configPath)).toBe(false)
    expect(result).toEqual({
      fileName: 'research paper.zh-CN.pdf',
      outputPath: managedPath(TRANSLATED_ENTRY_ID)
    })
  })

  it('streams validated monotonic progress from the BabelDOC Stream protocol', async () => {
    mocks.spawn.mockImplementationOnce((_command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stderr: PassThrough
        stdout: PassThrough
        kill: ReturnType<typeof vi.fn>
      }
      child.stderr = new PassThrough()
      child.stdout = new PassThrough()
      child.kill = vi.fn()

      const outputDir = args[args.indexOf('--output') + 1]
      fs.writeFileSync(path.join(outputDir, 'research paper.no_watermark.zh-CN.mono.pdf'), '%PDF-mono')
      queueMicrotask(() => {
        child.stdout.write(
          streamEvent({ type: 'progress', stage: 'checking_assets', stage_progress: null, overall_progress: 0 })
        )
        child.stdout.write(
          streamEvent({ type: 'progress', stage: 'downloading_assets', stage_progress: 42.3, overall_progress: 2.1 })
        )
        child.stdout.write('not-json\n')
        child.stdout.write(
          `${JSON.stringify({
            schema: 'babeldoc-stream/v1',
            type: 'progress',
            stage: 'Translate Paragraphs',
            progress: 50
          })}\n`
        )
        child.stdout.write(
          streamEvent({ type: 'progress', stage: 'translating', stage_progress: 55.4, overall_progress: 58.2 })
        )
        child.stdout.write(
          streamEvent({ type: 'progress', stage: 'parsing', stage_progress: 90, overall_progress: 40 })
        )
        child.stdout.write(finishEvent())
        child.stdout.end()
        child.emit('close', 0, null)
      })
      return child
    })
    const onStage = vi.fn()
    const onProgress = vi.fn()
    const service = new PdfTranslationService()

    await service.translate(
      {
        jobId: 'job-progress',
        modelId: 'openai::gpt-4.1-internal',
        sourcePath: SOURCE_PATH,
        sourceLangCode: 'en-us',
        targetLangCode: 'zh-cn'
      },
      onStage,
      onProgress
    )

    expect(onStage.mock.calls.map(([stage]) => stage)).toEqual(['preparing', 'translating'])
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { stage: 'checking_assets', stageProgress: null, overallProgress: 0 },
      { stage: 'downloading_assets', stageProgress: 42.3, overallProgress: 2.1 },
      { stage: 'translating', stageProgress: 55.4, overallProgress: 58.2 },
      { stage: 'rendering', stageProgress: 100, overallProgress: 100 }
    ])
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('Ignored malformed BabelDOC Stream event')
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('Ignored invalid BabelDOC Stream event')
  })

  it('uses BabelDOC language aliases for simplified and traditional Chinese', async () => {
    const service = new PdfTranslationService()

    const result = await service.translate({
      jobId: 'job-language-aliases',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'zh-hans',
      targetLangCode: 'zh-hant'
    })

    const args = mocks.spawn.mock.calls[0][1] as string[]
    expect(args).toEqual(expect.arrayContaining(['--lang-in', 'zh-CN', '--lang-out', 'zh-TW']))
    expect(result.fileName).toBe('research paper.zh-TW.pdf')
  })

  it('records the translation in history and hands both PDFs to FileManager', async () => {
    const service = new PdfTranslationService()

    await service.translate({
      jobId: 'job-history',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    })

    // The artifact is copied in and kept alive only by the history ref…
    expect(fileManager.createInternalEntry).toHaveBeenCalledWith({
      source: 'path',
      path: path.join(TEST_ROOT, 'job-history', 'research paper.no_watermark.zh-CN.mono.pdf'),
      cleanupPolicy: 'delete_when_unreferenced'
    })
    expect(fileManager.rename).toHaveBeenCalledWith(TRANSLATED_ENTRY_ID, 'research paper.zh-CN')
    // …while the user's original is only referenced, never copied.
    expect(fileManager.ensureExternalEntry).toHaveBeenCalledWith({
      externalPath: SOURCE_PATH,
      cleanupPolicy: 'delete_when_unreferenced'
    })
    expect(mocks.createFileTx).toHaveBeenCalledWith(tx, {
      sourceText: 'research paper.pdf',
      targetText: 'research paper.zh-CN.pdf',
      sourceLanguage: 'en-us',
      targetLanguage: 'zh-cn',
      targetFileEntryId: TRANSLATED_ENTRY_ID,
      sourceFileEntryId: SOURCE_ENTRY_ID
    })
    expect(mocks.notifyDataApiDataChange).toHaveBeenCalledWith([
      { endpoint: '/translate/histories', kind: 'membership', entityIds: [HISTORY_ID] }
    ])
    expect(fileManager.permanentDelete).not.toHaveBeenCalled()
    // The temp dir is gone even though the run succeeded — its content now lives in FileManager.
    expect(fs.existsSync(path.join(TEST_ROOT, 'job-history'))).toBe(false)
  })

  it('records an auto-detected source language as null', async () => {
    const service = new PdfTranslationService()

    await service.translate({
      jobId: 'job-auto-lang',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'auto',
      targetLangCode: 'zh-cn'
    })

    expect(mocks.createFileTx).toHaveBeenCalledWith(tx, expect.objectContaining({ sourceLanguage: null }))
  })

  it('keeps the translation when the source PDF cannot be referenced', async () => {
    fileManager.ensureExternalEntry.mockRejectedValueOnce(new Error('case-collision'))
    const service = new PdfTranslationService()

    const result = await service.translate({
      jobId: 'job-source-unreferenceable',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    })

    expect(result.fileName).toBe('research paper.zh-CN.pdf')
    expect(mocks.createFileTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ targetFileEntryId: TRANSLATED_ENTRY_ID })
    )
    expect(mocks.createFileTx.mock.calls[0][1]).not.toHaveProperty('sourceFileEntryId')
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'Failed to reference the source PDF; recording the translation without it',
      expect.objectContaining({ jobId: 'job-source-unreferenceable', sourcePath: SOURCE_PATH })
    )
  })

  it('cancels before writing history when source registration is still pending', async () => {
    let resolveSourceEntry!: (entry: { id: string; name: string; ext: string }) => void
    fileManager.ensureExternalEntry.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSourceEntry = resolve
        })
    )
    const service = new PdfTranslationService()

    const translation = service.translate({
      jobId: 'job-cancel-persistence',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    })
    await vi.waitFor(() => expect(fileManager.ensureExternalEntry).toHaveBeenCalledTimes(1))

    service.cancel('job-cancel-persistence')
    resolveSourceEntry({ id: SOURCE_ENTRY_ID, name: 'research paper', ext: 'pdf' })

    await expect(translation).rejects.toThrow('PDF translation cancelled')
    expect(mocks.createFileTx).not.toHaveBeenCalled()
    expect(fileManager.permanentDelete).toHaveBeenCalledWith(TRANSLATED_ENTRY_ID)
    expect(mockMainLoggerService.error).not.toHaveBeenCalledWith(
      'Failed to persist translated PDF result',
      expect.anything(),
      expect.anything()
    )
  })

  it('deletes the translated entry when the history write fails', async () => {
    mocks.createFileTx.mockImplementationOnce(() => {
      throw new Error('history write failed')
    })
    const service = new PdfTranslationService()

    const translation = service.translate({
      jobId: 'job-history-failure',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    })

    await expect(translation).rejects.toMatchObject({
      code: translateErrorCodes.PDF_RESULT_PERSIST_FAILED,
      message: 'The PDF was translated, but its result could not be saved'
    })
    // Without the compensating delete the entry would sit in the file manager as an
    // unexplained PDF until the cleanup grace window elapsed.
    expect(fileManager.permanentDelete).toHaveBeenCalledWith(TRANSLATED_ENTRY_ID)
    expect(mocks.notifyDataApiDataChange).not.toHaveBeenCalled()
  })

  it('reports a persistence failure when the translated entry cannot be created', async () => {
    fileManager.createInternalEntry.mockRejectedValueOnce(new Error('copy failed'))
    const service = new PdfTranslationService()

    const translation = service.translate({
      jobId: 'job-entry-failure',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    })

    await expect(translation).rejects.toMatchObject({
      code: translateErrorCodes.PDF_RESULT_PERSIST_FAILED,
      message: 'The PDF was translated, but its result could not be saved'
    })
    expect(fileManager.permanentDelete).not.toHaveBeenCalled()
    expect(mocks.createFileTx).not.toHaveBeenCalled()
  })

  it('keeps the BabelDOC-derived name when the display name is too long', async () => {
    const stem = 'a'.repeat(250)
    const sourcePath = path.join(TEST_ROOT, 'source', `${stem}.pdf`) as AbsoluteFilePath
    fs.writeFileSync(sourcePath, '%PDF-test')
    vi.spyOn(fs.promises, 'access').mockResolvedValue(undefined)
    mocks.spawn.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & {
        stderr: PassThrough
        stdout: PassThrough
        kill: ReturnType<typeof vi.fn>
      }
      child.stderr = new PassThrough()
      child.stdout = new PassThrough()
      child.kill = vi.fn()
      queueMicrotask(() => {
        child.stdout.write(finishEvent())
        child.stdout.end()
        child.emit('close', 0, null)
      })
      return child
    })
    const service = new PdfTranslationService()

    const result = await service.translate({
      jobId: 'job-unsafe-display-name',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath,
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    })

    expect(result.fileName).toContain('.no_watermark.zh-CN.mono.pdf')
    expect(fileManager.rename).not.toHaveBeenCalled()
    expect(fileManager.permanentDelete).not.toHaveBeenCalled()
  })

  it('keeps the BabelDOC-derived name when applying the display name fails', async () => {
    fileManager.rename.mockRejectedValueOnce(new Error('rename failed'))
    const service = new PdfTranslationService()

    const result = await service.translate({
      jobId: 'job-display-name-failed',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    })

    expect(result.fileName).toBe('research paper.no_watermark.zh-CN.mono.pdf')
    expect(fileManager.permanentDelete).not.toHaveBeenCalled()
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'Failed to apply the translated PDF display name; keeping the BabelDOC-derived name',
      expect.objectContaining({
        entryId: TRANSLATED_ENTRY_ID,
        error: 'Error: rename failed',
        jobId: 'job-display-name-failed'
      })
    )
  })

  it.each([
    ['missing', {}],
    [
      'not applied',
      {
        'babeldoc-stream': {
          name: 'babeldoc-stream',
          availability: { source: 'none' },
          application: { status: 'absent' }
        }
      }
    ]
  ])('requires BabelDOC to be installed manually when it is %s', async (_case, snapshots) => {
    binaryManager.getToolSnapshots.mockResolvedValueOnce(snapshots)
    const service = new PdfTranslationService()

    const translation = service.translate({
      jobId: 'job-reconcile-failed',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    })

    await expect(translation).rejects.toMatchObject({
      code: translateErrorCodes.PDF_DEPENDENCY_NOT_INSTALLED
    })

    expect(mocks.getBinaryPath).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('requires an update when the installed BabelDOC cannot provide v2 progress', async () => {
    binaryManager.getToolSnapshots.mockResolvedValueOnce({
      'babeldoc-stream': {
        name: 'babeldoc-stream',
        availability: { source: 'mise', path: MANAGED_BINARY },
        application: { status: 'applied', version: '0.6.4.post1' }
      }
    })
    const service = new PdfTranslationService()

    const translation = service.translate({
      jobId: 'job-outdated',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    })

    await expect(translation).rejects.toMatchObject({ code: translateErrorCodes.PDF_DEPENDENCY_OUTDATED })
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('requires OCR when BabelDOC detects a scanned PDF', async () => {
    mocks.spawn.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & {
        stderr: PassThrough
        stdout: PassThrough
        kill: ReturnType<typeof vi.fn>
      }
      child.stderr = new PassThrough()
      child.stdout = new PassThrough()
      child.kill = vi.fn()
      queueMicrotask(() => {
        child.stdout.write(streamEvent({ type: 'error', name: 'ScannedPDFError', message: 'Scanned PDF detected.' }))
        child.stdout.end()
        child.emit('close', 1, null)
      })
      return child
    })
    const service = new PdfTranslationService()

    const translation = service.translate({
      jobId: 'job-scanned-pdf',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    })

    await expect(translation).rejects.toMatchObject({ code: translateErrorCodes.PDF_OCR_REQUIRED })
    expect(apiGateway.releaseLease).toHaveBeenCalledTimes(1)
    expect(fs.existsSync(path.join(TEST_ROOT, 'job-scanned-pdf'))).toBe(false)
  })

  it('terminates the sidecar and cleans partial output when the job is cancelled', async () => {
    let child: (EventEmitter & { stderr: PassThrough; stdout: PassThrough; kill: ReturnType<typeof vi.fn> }) | undefined
    mocks.spawn.mockImplementationOnce(() => {
      child = new EventEmitter() as typeof child & EventEmitter
      child.stderr = new PassThrough()
      child.stdout = new PassThrough()
      child.kill = vi.fn()
      return child
    })
    const service = new PdfTranslationService()
    const pending = service.translate({
      jobId: 'job-cancel',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    })

    await vi.waitFor(() => expect(child).toBeDefined())
    service.cancel('job-cancel')
    child!.emit('close', null, 'SIGTERM')

    await expect(pending).rejects.toThrow('PDF translation cancelled')
    expect(child!.kill).toHaveBeenCalledTimes(1)
    expect(fs.existsSync(path.join(TEST_ROOT, 'job-cancel'))).toBe(false)
    expect(apiGateway.releaseLease).toHaveBeenCalledTimes(1)
    // Cancellation is expected — it must not be logged as a failure.
    expect(mockMainLoggerService.error).not.toHaveBeenCalledWith(
      'PDF translation failed',
      expect.anything(),
      expect.anything()
    )
  })

  it('kills the sidecar when cancel lands in the window between the last check and spawn', async () => {
    type TestChild = EventEmitter & { stderr: PassThrough; stdout: PassThrough; kill: ReturnType<typeof vi.fn> }
    let child: TestChild | undefined
    const service = new PdfTranslationService()
    mocks.spawn.mockImplementationOnce(() => {
      child = new EventEmitter() as TestChild
      child.stderr = new PassThrough()
      child.stdout = new PassThrough()
      // Killing the child mimics the OS reaping the process we just spawned.
      child.kill = vi.fn(() => queueMicrotask(() => child!.emit('close', null, 'SIGTERM')))
      // A cancel that raced in after the last throwIfCancelled but before job.child was assigned:
      // cancel() sees a null child and kills nothing, so only the post-spawn re-check can stop it.
      service.cancel('job-cancel-race')
      return child
    })

    const pending = service.translate({
      jobId: 'job-cancel-race',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    })

    await expect(pending).rejects.toThrow('PDF translation cancelled')
    expect(child!.kill).toHaveBeenCalledTimes(1)
    expect(fs.existsSync(path.join(TEST_ROOT, 'job-cancel-race'))).toBe(false)
  })

  it('waits for active translation cleanup before stopping', async () => {
    type TestChild = EventEmitter & { stderr: PassThrough; stdout: PassThrough; kill: ReturnType<typeof vi.fn> }
    let child: TestChild | undefined
    mocks.spawn.mockImplementationOnce(() => {
      child = new EventEmitter() as TestChild
      child.stderr = new PassThrough()
      child.stdout = new PassThrough()
      child.kill = vi.fn()
      return child
    })
    class TestPdfTranslationService extends PdfTranslationService {
      public stopForTest() {
        return this.onStop()
      }
    }
    const service = new TestPdfTranslationService()
    const translation = service.translate({
      jobId: 'job-stop',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    })

    await vi.waitFor(() => expect(child).toBeDefined())
    let stopped = false
    const stopping = service.stopForTest().then(() => {
      stopped = true
    })
    await Promise.resolve()

    expect(child!.kill).toHaveBeenCalledTimes(1)
    expect(stopped).toBe(false)

    child!.emit('close', null, 'SIGTERM')
    await Promise.all([stopping, expect(translation).rejects.toThrow('PDF translation cancelled')])

    expect(fs.existsSync(path.join(TEST_ROOT, 'job-stop'))).toBe(false)
    expect(apiGateway.releaseLease).toHaveBeenCalledTimes(1)
  })

  it('takes and releases exactly one gateway lease per concurrent job', async () => {
    type TestChild = EventEmitter & { stderr: PassThrough; stdout: PassThrough; kill: ReturnType<typeof vi.fn> }
    const children = new Map<string, TestChild>()
    mocks.spawn.mockImplementation((_command: string, args: string[]) => {
      const child = new EventEmitter() as TestChild
      child.stderr = new PassThrough()
      child.stdout = new PassThrough()
      child.kill = vi.fn()
      const outputDir = args[args.indexOf('--output') + 1]
      fs.mkdirSync(outputDir, { recursive: true })
      fs.writeFileSync(path.join(outputDir, 'research paper.no_watermark.zh-CN.mono.pdf'), '%PDF-mono')
      children.set(path.basename(outputDir), child)
      return child
    })
    const service = new PdfTranslationService()
    const translate = (jobId: string) =>
      service.translate({
        jobId,
        modelId: 'openai::gpt-4.1-internal',
        sourcePath: SOURCE_PATH,
        sourceLangCode: 'en-us',
        targetLangCode: 'zh-cn'
      })

    const first = translate('job-first')
    const second = translate('job-second')
    await vi.waitFor(() => expect(children.size).toBe(2))
    // The service holds a lease per job; keeping the gateway up until the last lease drops is the
    // gateway's own ref-counted concern (covered in ApiGatewayService tests), not the service's.
    expect(apiGateway.acquireLease).toHaveBeenCalledTimes(2)

    children.get('job-first')!.stdout.write(finishEvent())
    children.get('job-first')!.emit('close', 0, null)
    await first
    expect(apiGateway.releaseLease).toHaveBeenCalledTimes(1)

    children.get('job-second')!.stdout.write(finishEvent())
    children.get('job-second')!.emit('close', 0, null)
    await second
    expect(apiGateway.releaseLease).toHaveBeenCalledTimes(2)
  })

  it('logs the failure and surfaces the stderr tail when the sidecar exits non-zero', async () => {
    mocks.spawn.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & {
        stderr: PassThrough
        stdout: PassThrough
        kill: ReturnType<typeof vi.fn>
      }
      child.stderr = new PassThrough()
      child.stdout = new PassThrough()
      child.kill = vi.fn()
      queueMicrotask(() => {
        child.stderr.write('babeldoc: fatal: model download failed\n')
        child.stderr.end()
        child.emit('close', 1, null)
      })
      return child
    })
    const service = new PdfTranslationService()

    const translation = service.translate({
      jobId: 'job-nonzero-exit',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    })

    await expect(translation).rejects.toThrow('babeldoc: fatal: model download failed')
    expect(mockMainLoggerService.error).toHaveBeenCalledWith(
      'PDF translation failed',
      expect.any(Error),
      expect.objectContaining({ jobId: 'job-nonzero-exit' })
    )
    expect(apiGateway.releaseLease).toHaveBeenCalledTimes(1)
    expect(fs.existsSync(path.join(TEST_ROOT, 'job-nonzero-exit'))).toBe(false)
  })

  it('rejects an exit-zero sidecar that omits the terminal finish event', async () => {
    mocks.spawn.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & {
        stderr: PassThrough
        stdout: PassThrough
        kill: ReturnType<typeof vi.fn>
      }
      child.stderr = new PassThrough()
      child.stdout = new PassThrough()
      child.kill = vi.fn()
      queueMicrotask(() => child.emit('close', 0, null))
      return child
    })
    const service = new PdfTranslationService()

    const translation = service.translate({
      jobId: 'job-missing-finish',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    })

    await expect(translation).rejects.toThrow('without a finish event')
    expect(fs.existsSync(path.join(TEST_ROOT, 'job-missing-finish'))).toBe(false)
  })

  it('sweeps stale temp output directories on init', async () => {
    const staleDir = path.join(TEST_ROOT, 'job-stale')
    fs.mkdirSync(staleDir, { recursive: true })
    fs.writeFileSync(path.join(staleDir, 'leftover.pdf'), '%PDF-old')
    class TestPdfTranslationService extends PdfTranslationService {
      public initForTest() {
        return this.onInit()
      }
    }
    const service = new TestPdfTranslationService()

    await service.initForTest()

    expect(fs.existsSync(staleDir)).toBe(false)
  })

  describe('sidecar proxy environment', () => {
    const PROXY_KEYS = ['ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']

    beforeEach(() => {
      // The sidecar reads proxy settings off `process.env`, so a proxy configured on the
      // machine running the suite would otherwise leak into these assertions.
      for (const key of PROXY_KEYS) {
        vi.stubEnv(key, '')
        vi.stubEnv(key.toLowerCase(), '')
      }
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    const spawnedEnv = async (): Promise<Record<string, string>> => {
      const service = new PdfTranslationService()
      await service.translate({
        jobId: 'job-proxy',
        modelId: 'openai::gpt-4.1-internal',
        sourcePath: SOURCE_PATH,
        sourceLangCode: 'en-us',
        targetLangCode: 'zh-cn'
      })
      return mocks.spawn.mock.calls[0][2].env
    }

    it("inherits Cherry's proxy decision and exempts the loopback gateway from it", async () => {
      vi.stubEnv('HTTP_PROXY', 'http://127.0.0.1:7890')
      vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7890')
      vi.stubEnv('NO_PROXY', 'localhost,*.local')

      const env = await spawnedEnv()

      expect(env.HTTP_PROXY).toBe('http://127.0.0.1:7890')
      expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:7890')
      expect(env.NO_PROXY.split(',')).toEqual(['localhost', '*.local', '127.0.0.1'])
      expect(env.no_proxy).toBe(env.NO_PROXY)
    })

    it('exempts the gateway even when no proxy is configured', async () => {
      // Windows Python resolves proxies from the WinINET registry when the env carries none,
      // which sends the loopback gateway call through the system proxy and 502s every paragraph.
      const env = await spawnedEnv()

      expect(env.NO_PROXY).toBe('127.0.0.1')
    })

    it('strips the brackets an IPv6 gateway host carries', async () => {
      apiGateway.getCurrentConfig.mockReturnValue({ host: '::', port: 23333 })

      const env = await spawnedEnv()

      expect(env.NO_PROXY).toBe('::1')
    })

    it('leaves a bypass list that already covers the gateway untouched', async () => {
      vi.stubEnv('NO_PROXY', '127.0.0.1,localhost')

      const env = await spawnedEnv()

      expect(env.NO_PROXY).toBe('127.0.0.1,localhost')
    })
  })
})
