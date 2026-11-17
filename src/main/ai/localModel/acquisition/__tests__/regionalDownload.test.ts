import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BundleFile, ModelBundle } from '../../catalog/types'
import { downloadBundleFiles } from '../bundleDownload'
import { modelSourceOrder } from '../modelSource'

const CONTENT = 'verified regional weights'
const URLS = { china: 'https://modelscope.cn/weights', global: 'https://github.com/weights' }
const FILE: BundleFile = {
  key: 'weights',
  relPath: 'model.safetensors',
  urls: URLS,
  sha256: 'fa90a2ff5342eae2188f54999f47de29dec613bc5bd55eb7b40094ebe357a9e9',
  sizeBytes: CONTENT.length,
  minBytes: CONTENT.length,
  weight: 1
}
const BUNDLE: ModelBundle = {
  id: 'qwen3-tts-0.6b-customvoice-8bit',
  capability: 'tts',
  installDirKey: 'feature.tts.qwen3',
  files: [FILE],
  requires: ['mlx-node']
}
let installDir: string

beforeEach(() => {
  vi.clearAllMocks()
  installDir = mkdtempSync(path.join(tmpdir(), 'regional-model-download-'))
})

afterEach(() => rmSync(installDir, { recursive: true, force: true }))

describe.each([
  { preference: 'china-first' as const, first: URLS.china, second: URLS.global },
  { preference: 'global-first' as const, first: URLS.global, second: URLS.china }
])('$preference model download', ({ preference, first, second }) => {
  it.each(['valid', 'corrupt', 'unreachable'])(
    'installs verified bytes when the preferred source is %s',
    async (state) => {
      const requested: string[] = []
      vi.mocked(net.fetch).mockImplementation(async (input) => {
        const url = String(input)
        requested.push(url)
        if (url === first && state === 'unreachable') throw new Error('network unavailable')
        return new Response(url === first && state === 'corrupt' ? 'corrupt weights' : CONTENT)
      })

      await downloadBundleFiles(BUNDLE, [FILE], {
        sourceOrder: modelSourceOrder(preference),
        signal: new AbortController().signal,
        installDir
      })

      expect(readFileSync(path.join(installDir, FILE.relPath), 'utf8')).toBe(CONTENT)
      expect(requested).toEqual(state === 'valid' ? [first] : [first, second])
    }
  )

  it('does not try the other region or install a file after cancellation', async () => {
    const controller = new AbortController()
    const requested: string[] = []
    vi.mocked(net.fetch).mockImplementation(async (input) => {
      requested.push(String(input))
      controller.abort()
      throw controller.signal.reason
    })

    await expect(
      downloadBundleFiles(BUNDLE, [FILE], {
        sourceOrder: modelSourceOrder(preference),
        signal: controller.signal,
        installDir
      })
    ).rejects.toThrow()

    expect(requested).toEqual([first])
    expect(existsSync(path.join(installDir, FILE.relPath))).toBe(false)
  })
})
