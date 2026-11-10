import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { resolveAsrModelPaths } from '../../capabilities/asr/modelPaths'
import { bundleFile, getModelBundle } from '../../catalog/catalog'
import { BundleInstaller } from '../BundleInstaller'
import { localModelStorageService } from '../LocalModelStorageService'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const bundle = getModelBundle('funasr-nano-int8')
let installDir: string

function writeSparseFile(relPath: string, size: number): void {
  const target = path.join(installDir, relPath)
  mkdirSync(path.dirname(target), { recursive: true })
  const fd = openSync(target, 'w')
  try {
    ftruncateSync(fd, size)
  } finally {
    closeSync(fd)
  }
}

beforeEach(() => {
  installDir = mkdtempSync(path.join(tmpdir(), 'funasr-upgrade-'))
  vi.mocked(application.getPath).mockImplementation((_key, filename) =>
    filename ? path.join(installDir, filename) : installDir
  )
  vi.spyOn(localModelStorageService, 'isArtifactReady').mockReturnValue(true)
  for (const file of bundle.files) {
    if (file.key !== 'llm') writeSparseFile(file.relPath, file.minBytes)
  }
  writeSparseFile('llm.int8.onnx', 600_356_593)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(installDir, { recursive: true, force: true })
})

describe('FunASR compatibility model upgrade', () => {
  it('rejects the old decoder and requests only the compatibility decoder', () => {
    expect(localModelStorageService.scanBundleFiles(bundle)).toEqual({
      status: 'incomplete',
      missingFiles: ['llm.int8.compat.onnx']
    })
    expect(localModelStorageService.pendingBundleFiles(bundle).map((file) => file.key)).toEqual(['llm'])
    expect(() => resolveAsrModelPaths(bundle.id)).toThrow('not fully downloaded')

    const installer = new BundleInstaller(
      bundle,
      { terminateRuntimeThen: async (after) => after() },
      () => {},
      async () => {}
    )
    expect(installer.getStatusInfo()).toEqual({ status: 'error', errorCode: 'incomplete_cache' })
  })

  it('does not load a partial replacement or fall back to the old decoder', () => {
    writeSparseFile('llm.int8.compat.onnx', 1)

    expect(localModelStorageService.pendingBundleFiles(bundle).map((file) => file.key)).toEqual(['llm'])
    expect(() => resolveAsrModelPaths(bundle.id)).toThrow('not fully downloaded')
    expect(statSync(path.join(installDir, 'llm.int8.onnx')).size).toBe(600_356_593)
  })

  it('loads the compatibility decoder when both generations exist, reusing the other files', () => {
    writeSparseFile('llm.int8.compat.onnx', 600_339_316)

    expect(localModelStorageService.scanBundleFiles(bundle)).toEqual({ status: 'installed' })
    expect(localModelStorageService.pendingBundleFiles(bundle)).toEqual([])
    expect(resolveAsrModelPaths(bundle.id)).toMatchObject({
      engine: 'sherpa',
      modelPaths: {
        llm: path.join(installDir, 'llm.int8.compat.onnx'),
        encoder: path.join(installDir, 'encoder_adaptor.int8.onnx'),
        embedding: path.join(installDir, 'embedding.int8.onnx')
      }
    })
    expect(existsSync(path.join(installDir, 'llm.int8.onnx'))).toBe(true)
  })

  it('pins the upstream compatibility artifact instead of the incompatible HF copy', () => {
    const llm = bundleFile(bundle, 'llm')
    expect(llm.sha256).toBe('7f0c5a508b41474b1b1ec1cdbdefafd2cf8b3642c6915a0a425265b7b7d2c960')
    expect(llm).toMatchObject({ sizeBytes: 600_339_316 })
    expect(llm.sources).toEqual([
      {
        source: 'modelscope',
        repo: 'zengshuishui/FunASR-nano-onnx',
        revision: 'ce0975f2a7a8ad6441223db59ce6e1362295ddfe',
        remoteFile: 'llm_int8_compat/llm.int8.onnx'
      }
    ])
  })
})
