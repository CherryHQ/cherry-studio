import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelBundle } from '../types'

let installDir: string

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGetPath = result.application.getPath.getMockImplementation()!
  result.application.getPath.mockImplementation((key: string, filename?: string) => {
    if (key === 'feature.ocr.paddleocr') return filename ? path.join(installDir, filename) : installDir
    return originalGetPath(key, filename)
  })
  return result
})

const { localModelRegistry } = await import('../LocalModelRegistry')

const BUNDLE: ModelBundle = {
  id: 'pp-ocrv6-medium',
  capability: 'ocr',
  installDirKey: 'feature.ocr.paddleocr',
  requires: ['onnxruntime-node'],
  files: [
    { key: 'a', relPath: 'a.onnx', repo: 'r', remoteFile: 'a', sha256: 'x'.repeat(64), minBytes: 10, weight: 1 },
    { key: 'b', relPath: 'nested/b.onnx', repo: 'r', remoteFile: 'b', sha256: 'y'.repeat(64), minBytes: 10, weight: 1 }
  ]
}

function writeBundleFile(relPath: string, size: number): void {
  const target = path.join(installDir, relPath)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, Buffer.alloc(size))
}

describe('scanBundleFiles', () => {
  beforeEach(() => {
    installDir = mkdtempSync(path.join(tmpdir(), 'local-model-registry-test-'))
  })

  afterEach(() => rmSync(installDir, { recursive: true, force: true }))

  it('reports not_installed when nothing is on disk', () => {
    expect(localModelRegistry.scanBundleFiles(BUNDLE)).toEqual({ status: 'not_installed' })
  })

  it('reports installed once every file is present and large enough', () => {
    writeBundleFile('a.onnx', 20)
    writeBundleFile('nested/b.onnx', 20)

    expect(localModelRegistry.scanBundleFiles(BUNDLE)).toEqual({ status: 'installed' })
  })

  it('reports which files are missing when only some arrived', () => {
    writeBundleFile('a.onnx', 20)

    expect(localModelRegistry.scanBundleFiles(BUNDLE)).toEqual({
      status: 'incomplete',
      missingFiles: ['nested/b.onnx']
    })
  })

  it('treats a truncated file as missing rather than installed', () => {
    writeBundleFile('a.onnx', 20)
    // A killed download before checksums existed could leave a stub behind; counting it
    // as installed would surface as an unreadable model at inference time instead.
    writeBundleFile('nested/b.onnx', 1)

    expect(localModelRegistry.scanBundleFiles(BUNDLE)).toEqual({
      status: 'incomplete',
      missingFiles: ['nested/b.onnx']
    })
  })

  it('treats a directory sitting where a file belongs as missing', () => {
    writeBundleFile('a.onnx', 20)
    mkdirSync(path.join(installDir, 'nested', 'b.onnx'), { recursive: true })

    expect(localModelRegistry.scanBundleFiles(BUNDLE).status).toBe('incomplete')
  })
})
