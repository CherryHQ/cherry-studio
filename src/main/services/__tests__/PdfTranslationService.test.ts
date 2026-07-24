import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { translateErrorCodes } from '@shared/ipc/errors/translate'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appGet: vi.fn(),
  getBinaryPath: vi.fn(),
  modelGetByKey: vi.fn(),
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
const SOURCE_PATH = path.join(TEST_ROOT, 'source', 'research paper.pdf')
const MANAGED_BINARY = path.join(TEST_ROOT, 'managed', 'babeldoc')

const binaryManager = { getToolSnapshots: vi.fn() }
const apiGateway = {
  acquireLease: vi.fn(),
  ensureValidApiKey: vi.fn(),
  getCurrentConfig: vi.fn(),
  releaseLease: vi.fn()
}

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
      throw new Error(`Unexpected service: ${name}`)
    })
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
      babeldoc: {
        name: 'babeldoc',
        availability: { source: 'mise', path: MANAGED_BINARY },
        application: { status: 'applied' }
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
      queueMicrotask(() => child.emit('close', 0, null))
      return child
    })
  })

  afterEach(() => {
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
    const args = mocks.spawn.mock.calls[0][1] as string[]
    expect(args).not.toContain('--no-mono')
    expect(args).not.toContain('--auto-enable-ocr-workaround')
    const configPath = args[args.indexOf('--config') + 1]
    expect(configPath).toContain('job-1')
    expect(args).not.toContain('cs-sk-test')
    expect(fs.existsSync(configPath)).toBe(false)
    expect(result).toEqual({
      fileName: 'research paper.no_watermark.zh-CN.mono.pdf',
      outputPath: expect.stringContaining(path.join('job-1', 'research paper.no_watermark.zh-CN.mono.pdf'))
    })
  })

  it('streams validated monotonic progress from the BabelDOC adapter', async () => {
    let adapterPath = ''
    mocks.spawn.mockImplementationOnce((_command: string, args: string[], options: { env: Record<string, string> }) => {
      const child = new EventEmitter() as EventEmitter & {
        stderr: PassThrough
        stdout: PassThrough
        kill: ReturnType<typeof vi.fn>
      }
      child.stderr = new PassThrough()
      child.stdout = new PassThrough()
      child.kill = vi.fn()

      adapterPath = path.join(options.env.PYTHONPATH, 'sitecustomize.py')
      expect(fs.existsSync(adapterPath)).toBe(true)
      expect(fs.readFileSync(adapterPath, 'utf8')).toContain('if event_type == "error":')
      const outputDir = args[args.indexOf('--output') + 1]
      fs.writeFileSync(path.join(outputDir, 'research paper.no_watermark.zh-CN.mono.pdf'), '%PDF-mono')
      queueMicrotask(() => {
        child.stdout.write('doclayout onnx model not found or corrupted, downloading...\n')
        child.stdout.write('__CHERRY_BABELDOC_PROGRESS__{"stage":"Parse PDF","progress":12.4}\n')
        child.stdout.write('__CHERRY_BABELDOC_PROGRESS__not-json\n')
        child.stdout.write('__CHERRY_BABELDOC_PROGRESS__{"stage":"Translate Paragraphs","progress":55.4}\n')
        child.stdout.write('__CHERRY_BABELDOC_PROGRESS__{"stage":"Parse PDF","progress":40}\n')
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

    expect(onStage.mock.calls.map(([stage]) => stage)).toEqual([
      'preparing',
      'translating',
      'downloading_assets',
      'translating'
    ])
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { stage: 'parsing', progress: 12 },
      { stage: 'translating', progress: 55 },
      { stage: 'rendering', progress: 100 }
    ])
    expect(fs.existsSync(adapterPath)).toBe(false)
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
    expect(result.fileName).toBe('research paper.no_watermark.zh-TW.mono.pdf')
  })

  it.each([
    ['missing', {}],
    [
      'not applied',
      { babeldoc: { name: 'babeldoc', availability: { source: 'none' }, application: { status: 'absent' } } }
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
        child.stdout.write('__CHERRY_BABELDOC_ERROR__{"name":"ScannedPDFError","message":"Scanned PDF detected."}\n')
        child.stdout.end()
        child.emit('close', 0, null)
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

    children.get('job-first')!.emit('close', 0, null)
    await first
    expect(apiGateway.releaseLease).toHaveBeenCalledTimes(1)

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

  it('surfaces the OCR message and warns when the progress adapter fails on a scanned PDF', async () => {
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
        child.stderr.write('Cherry Studio progress adapter failed: cannot patch create_progress_handler\n')
        child.stderr.write('babeldoc.exceptions.ScannedPDFError: Scanned PDF detected.\n')
        child.stderr.end()
        child.emit('close', 1, null)
      })
      return child
    })
    const service = new PdfTranslationService()

    const translation = service.translate({
      jobId: 'job-adapter-scanned',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    })

    await expect(translation).rejects.toMatchObject({ code: translateErrorCodes.PDF_OCR_REQUIRED })
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      expect.stringContaining('progress adapter failed'),
      expect.objectContaining({ jobId: 'job-adapter-scanned' })
    )
    // OCR-required is an expected user condition (IpcError) → logged at warn, never error.
    expect(mockMainLoggerService.error).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(TEST_ROOT, 'job-adapter-scanned'))).toBe(false)
  })

  it('reports OCR-required for a scanned PDF that exits 0 without producing output', async () => {
    // BabelDOC 0.6.3 only logs the scanned-PDF error and breaks, so the sidecar can exit 0 with no
    // output file. The scanned-PDF match must win over the successful exit code, otherwise the run
    // resolves and then degrades into a generic "missing output" error.
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
        child.stderr.write('Cherry Studio progress adapter failed: cannot patch create_progress_handler\n')
        child.stderr.write('babeldoc.exceptions.ScannedPDFError: Scanned PDF detected.\n')
        child.stderr.end()
        child.emit('close', 0, null)
      })
      return child
    })
    const service = new PdfTranslationService()

    const translation = service.translate({
      jobId: 'job-scanned-exit-zero',
      modelId: 'openai::gpt-4.1-internal',
      sourcePath: SOURCE_PATH,
      sourceLangCode: 'en-us',
      targetLangCode: 'zh-cn'
    })

    await expect(translation).rejects.toMatchObject({ code: translateErrorCodes.PDF_OCR_REQUIRED })
    expect(fs.existsSync(path.join(TEST_ROOT, 'job-scanned-exit-zero'))).toBe(false)
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
})
