import type * as FsModule from 'node:fs'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { createRecordingLogger } from '@main/core/utilityProcess/__tests__/hostTestUtils'
import { createMemoryProcessAdapter } from '@main/core/utilityProcess/__tests__/memoryProcessAdapter'
import { UtilityProcessManager } from '@main/core/utilityProcess/UtilityProcessManager'

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    off: vi.fn(),
    getPath: vi.fn(() => '/mock/path'),
    getLocale: () => 'en-US',
    isPackaged: false,
    setAppLogsPath: vi.fn()
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn(), removeListener: vi.fn() },
  utilityProcess: { fork: vi.fn() },
  MessageChannelMain: vi.fn()
}))

const state = vi.hoisted(() => ({
  manager: null as unknown,
  bytes: { 'binding.node': 'binding!', 'runtime.dll': 'runtime!' }
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const original = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) =>
    name === 'UtilityProcessManager' ? state.manager : original(name)
  )
  return result
})
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof FsModule>()
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) }
})
vi.mock('../../../catalog/types', async (original) => ({
  ...(await original<typeof CatalogTypesModule>()),
  currentPlatformKey: () => 'test-platform'
}))
vi.mock('../../../catalog/catalog', async (original) => {
  const actual = await original<typeof CatalogModule>()
  return {
    ...actual,
    getSharedArtifact: () => ({
      id: 'onnxruntime-node',
      version: '1.25.1',
      installDirKey: 'feature.onnxruntime.binary',
      platforms: {
        'test-platform': {
          installSubdir: 'test-platform',
          entryFile: 'binding.node',
          supportFiles: ['runtime.dll'],
          tarballSha256: 'archive'
        }
      }
    })
  }
})
vi.mock('../../../catalog/onnxRuntimeIntegrity.json', async () => {
  const { createHash } = await import('node:crypto')
  return {
    default: {
      artifact: 'onnxruntime-node',
      version: '1.25.1',
      tarballSha256: 'archive',
      platforms: {
        'test-platform': {
          files: Object.fromEntries(
            Object.entries(state.bytes).map(([name, bytes]) => [
              name,
              { sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
            ])
          )
        }
      }
    }
  }
})

import type * as CatalogModule from '../../../catalog/catalog'
import { getModelBundle } from '../../../catalog/catalog'
import type * as CatalogTypesModule from '../../../catalog/types'
import { localModelStorageService } from '../../../installation/LocalModelStorageService'
import type { OcrInferenceContract } from '../../../runtime/inferenceProcess'
import { OcrInferenceService } from '../OcrInferenceService'

let root: string
let runtime: string
let manager: UtilityProcessManager
let service: OcrInferenceService
let adapter: ReturnType<typeof createMemoryProcessAdapter>
const recognized = {
  text: 'Readable scanned page',
  lines: [[{ text: 'Readable scanned page', box: { x: 1, y: 2, width: 30, height: 10 }, confidence: 0.99 }]]
}

beforeEach(async () => {
  BaseService.resetInstances()
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
  MockMainPreferenceServiceUtils.setPreferenceValue('feature.local_model.hardware_acceleration.enabled', false)
  root = await mkdtemp(path.join(os.tmpdir(), 'ocr-integrity-'))
  runtime = path.join(root, 'runtime', 'test-platform')
  const models = path.join(root, 'models')
  await mkdir(runtime, { recursive: true })
  await mkdir(models)
  vi.spyOn(application, 'getPath').mockImplementation((key, subdir) => {
    const dir = key === 'feature.onnxruntime.binary' ? path.join(root, 'runtime') : models
    return subdir ? path.join(dir, subdir) : dir
  })
  for (const [name, bytes] of Object.entries(state.bytes)) await writeFile(path.join(runtime, name), bytes)
  for (const file of getModelBundle('pp-ocrv6-medium').files) {
    await writeFile(path.join(models, file.relPath), '')
    await truncate(path.join(models, file.relPath), file.minBytes)
  }
  adapter = createMemoryProcessAdapter((child) => {
    child.serve<OcrInferenceContract>({ id: 'inference.ocr', handlers: { recognize: () => recognized } })
  })
  manager = new UtilityProcessManager({
    adapter,
    logger: createRecordingLogger(),
    resolveEntry: () => '/out/inference-ocr.js',
    getTempDir: () => root
  })
  await manager._doInit()
  state.manager = manager
  service = new OcrInferenceService()
  await service._doInit()
  vi.mocked(createReadStream).mockClear()
})
afterEach(async () => {
  await manager._doStop()
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

describe('OCR integrity admission before native dispatch', () => {
  it('rejects present but wrong runtime bytes with recovery instructions before any client request or spawn', async () => {
    await writeFile(path.join(runtime, 'runtime.dll'), 'foreign!')
    expect(localModelStorageService.isArtifactReady('onnxruntime-node')).toBe(true)
    expect(localModelStorageService.resolveInstalledDir(getModelBundle('pp-ocrv6-medium'))).not.toBeNull()
    const client = manager.client((await import('../../../runtime/inferenceProcess')).ocrInferenceProcess)
    const request = vi.spyOn(client, 'request')
    const error = await service.recognize({ kind: 'path', imagePath: '/scanned.png' }).catch((error: Error) => error)
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    for (const detail of [
      '1.25.1',
      runtime,
      'runtime.dll',
      'Fully quit Cherry Studio',
      'remove only that runtime folder',
      'restart',
      'Download',
      'Settings → Dependencies → Local Models',
      'retry or reindex'
    ])
      expect(message).toContain(detail)
    expect(request).not.toHaveBeenCalled()
    expect(adapter.spawns).toHaveLength(0)
  })

  it('passes healthy OCR results through and reuses the child without hashing again or restarting', async () => {
    const source = { kind: 'path' as const, imagePath: '/scanned.png' }
    await expect(service.recognize(source)).resolves.toEqual(recognized)
    const child = adapter.spawns[0].child
    vi.mocked(createReadStream).mockClear()
    await expect(service.recognize(source)).resolves.toEqual(recognized)
    expect(createReadStream).not.toHaveBeenCalled()
    expect(adapter.spawns).toHaveLength(1)
    expect(child.exited).toBe(false)
    expect(child.frames.filter((frame) => frame.kind === 'request')).toHaveLength(2)
  })
})
