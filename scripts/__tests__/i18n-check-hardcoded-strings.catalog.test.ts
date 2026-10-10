import type * as FileSystem from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

import { HardcodedStringDetector, main } from '../i18n-check-hardcoded-strings'

const filesystem = vi.hoisted(() => ({ existsSync: vi.fn(), readdirSync: vi.fn() }))
vi.mock('fs', async (importOriginal) => ({ ...(await importOriginal<typeof FileSystem>()), ...filesystem }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it('fails the strict gate for hardcoded UI strings in the portable preview package', () => {
  const directory = resolve('packages/file-preview/src')
  filesystem.existsSync.mockImplementation((path: string) => path === directory)
  filesystem.readdirSync.mockReturnValue([{ name: 'Preview.tsx', isDirectory: () => false, isFile: () => true }])
  vi.spyOn(HardcodedStringDetector.prototype, 'scanFile').mockReturnValue([
    {
      file: resolve(directory, 'Preview.tsx'),
      line: 1,
      content: '打开文件',
      source: 'file-preview',
      type: 'chinese',
      nodeType: 'JsxText'
    }
  ])
  vi.stubEnv('I18N_STRICT', 'true')
  const output = vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Exit ${code}`)
  })

  expect(main).toThrow('Exit 1')
  expect(output.mock.calls.flat().join('\n')).toContain('File Preview Package')
  expect(output.mock.calls.flat().join('\n')).toContain('Preview.tsx:1')
})
