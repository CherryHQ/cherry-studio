import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { translateErrorCodes } from '@shared/ipc/errors/translate'
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
      if (key === 'feature.pdf_translation.runtime') return path.join(TEST_ROOT, 'runtime')
      if (key === 'feature.binary.data') return path.join(TEST_ROOT, 'binary')
      throw new Error(`Unexpected path key: ${key}`)
    })
  }
}))

vi.mock('@data/services/ModelService', () => ({ modelService: { getByKey: mocks.modelGetByKey } }))
vi.mock('@main/utils/binaryResolver', () => ({ getBinaryPath: mocks.getBinaryPath }))
vi.mock('@main/utils/processRunner', () => ({ crossPlatformSpawn: mocks.spawn }))
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

const binaryManager = { getState: vi.fn() }
const apiGateway = {
  ensureValidApiKey: vi.fn(),
  getCurrentConfig: vi.fn(),
  isRunning: vi.fn(),
  start: vi.fn(),
  stop: vi.fn()
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
    binaryManager.getState.mockReturnValue({
      tools: { babeldoc: { tool: 'pipx:babeldoc', version: '0.6.3' } }
    })
    apiGateway.isRunning.mockReturnValue(false)
    apiGateway.start.mockResolvedValue(undefined)
    apiGateway.stop.mockResolvedValue(undefined)
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
      fs.writeFileSync(path.join(outputDir, `research paper.${targetLanguage}.mono.pdf`), '%PDF-mono')
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

    expect(binaryManager.getState).toHaveBeenCalledTimes(1)
    expect(apiGateway.start).toHaveBeenCalledTimes(1)
    expect(apiGateway.stop).toHaveBeenCalledTimes(1)
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
        '--no-dual'
      ]),
      expect.objectContaining({
        cwd: expect.stringContaining('job-1'),
        env: expect.not.objectContaining({ OPENAI_API_KEY: 'shell-secret' })
      })
    )
    expect(mocks.spawn.mock.calls[0][2].env).toEqual(
      expect.objectContaining({ HOME: expect.stringContaining('runtime') })
    )
    const args = mocks.spawn.mock.calls[0][1] as string[]
    expect(args).not.toContain('--no-mono')
    const configPath = args[args.indexOf('--config') + 1]
    expect(configPath).toContain('job-1')
    expect(args).not.toContain('cs-sk-test')
    expect(fs.existsSync(configPath)).toBe(false)
    expect(result).toEqual({
      fileName: 'research paper.zh-CN.mono.pdf',
      outputPath: expect.stringContaining(path.join('job-1', 'research paper.zh-CN.mono.pdf'))
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
      const outputDir = args[args.indexOf('--output') + 1]
      fs.writeFileSync(path.join(outputDir, 'research paper.zh-CN.mono.pdf'), '%PDF-mono')
      queueMicrotask(() => {
        child.stdout.write('__CHERRY_BABELDOC_PROGRESS__{"stage":"Parse PDF","progress":12.4}\n')
        child.stdout.write('__CHERRY_BABELDOC_PROGRESS__not-json\n')
        child.stdout.write('__CHERRY_BABELDOC_PROGRESS__{"stage":"Translate Paragraphs","progress":55.4}\n')
        child.stdout.write('__CHERRY_BABELDOC_PROGRESS__{"stage":"Parse PDF","progress":40}\n')
        child.stdout.end()
        child.emit('close', 0, null)
      })
      return child
    })
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
      undefined,
      onProgress
    )

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
    expect(result.fileName).toBe('research paper.zh-TW.mono.pdf')
  })

  it.each([
    ['missing', {}],
    ['outdated', { babeldoc: { tool: 'pipx:babeldoc', version: '0.6.2' } }]
  ])('requires the pinned BabelDOC version to be installed manually when it is %s', async (_case, tools) => {
    binaryManager.getState.mockReturnValueOnce({ tools })
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
    expect(apiGateway.stop).toHaveBeenCalledTimes(1)
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
    expect(apiGateway.stop).toHaveBeenCalledTimes(1)
  })

  it('keeps a temporary API gateway running until all concurrent jobs finish', async () => {
    type TestChild = EventEmitter & { stderr: PassThrough; stdout: PassThrough; kill: ReturnType<typeof vi.fn> }
    const children = new Map<string, TestChild>()
    mocks.spawn.mockImplementation((_command: string, args: string[]) => {
      const child = new EventEmitter() as TestChild
      child.stderr = new PassThrough()
      child.stdout = new PassThrough()
      child.kill = vi.fn()
      const outputDir = args[args.indexOf('--output') + 1]
      fs.mkdirSync(outputDir, { recursive: true })
      fs.writeFileSync(path.join(outputDir, 'research paper.zh-CN.mono.pdf'), '%PDF-mono')
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
    expect(apiGateway.start).toHaveBeenCalledTimes(1)

    children.get('job-first')!.emit('close', 0, null)
    await first
    expect(apiGateway.stop).not.toHaveBeenCalled()

    children.get('job-second')!.emit('close', 0, null)
    await second
    expect(apiGateway.stop).toHaveBeenCalledTimes(1)
  })
})
