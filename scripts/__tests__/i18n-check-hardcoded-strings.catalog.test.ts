import type * as FileSystem from 'node:fs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

import { HardcodedStringDetector, main } from '../i18n-check-hardcoded-strings'

const filesystem = vi.hoisted(() => ({ existsSync: vi.fn(), readdirSync: vi.fn() }))
vi.mock('fs', async (importOriginal) => ({ ...(await importOriginal<typeof FileSystem>()), ...filesystem }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it.each(['renderer', 'main', 'file-preview'] as const)('preserves UI findings and exclusions in %s', (source) => {
  const directory = mkdtempSync(resolve(tmpdir(), 'cherry-i18n-scan-'))
  const file = resolve(directory, 'View.tsx')
  writeFileSync(
    file,
    `
    const amount = 1;
    const label = \`你好 \${amount}\`;
    const title = \`问候\`;
    const data = { message: '提示' };
    notification.info('通知');
    const view = <div title="标题">正文</div>;
    const english = <Button title="Save Changes" />;
    t('忽略翻译');
    logger.info('忽略日志');
    type Example = { label: '忽略类型' };
    enum Kind { One = '忽略枚举' }
    const languageNames = { text: '忽略语言' };
    const style = \`忽略代码\`;
  `
  )
  try {
    const expected = ['`你好 ${amount}`', '`问候`', "'提示'", "'通知'", 'title="标题"', '正文']
    if (source !== 'main') expected.push('title="Save Changes"')
    expect(
      new HardcodedStringDetector()
        .scanFile(file, source)
        .map((finding) => finding.content)
        .sort()
    ).toEqual(expected.sort())
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
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
