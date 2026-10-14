import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { Project } from 'ts-morph'

import {
  assertNoUnusedI18nKeys,
  collectUsedI18nKeys,
  collectUsedI18nKeysFromSource,
  createUnusedI18nResult,
  findSourceFiles,
  type I18N,
  type I18nCatalogConfig,
  removeI18nKeys,
  runCli,
  selectKeysByGroups
} from '../i18n-check-unused'

function createSourceFile(code: string, filePath = 'test.tsx') {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { jsx: 2 }
  })

  return project.createSourceFile(filePath, code, { overwrite: true })
}

describe('i18n-check-unused', () => {
  describe('collectUsedI18nKeysFromSource', () => {
    it('extracts static t, i18n.t, Trans i18nKey, key properties, and comment references', () => {
      const localeKeys = new Set([
        'agent.title',
        'common.cancel',
        'common.count_one',
        'common.count_other',
        'common.save',
        'common.tooltip',
        'openclaw.migration.title',
        'openclaw.not_installed.title',
        'paintings.zhipu.image_sizes.1024x1024_default',
        'settings.title',
        'trace.title'
      ])
      const sourceFile = createSourceFile(`
        // t('trace.title')
        const label = t('common.save')
        const count = t('common.count', { count: 2 })
        const title = i18n.t('settings.title')
        const openclawTitle = t(needsMigration ? 'openclaw.migration.title' : 'openclaw.not_installed.title')
        const config = { titleKey: 'agent.title', unrelated: 'common.cancel' }
        const option = { label: 'paintings.zhipu.image_sizes.1024x1024_default', value: '1024x1024' }
        export function View() {
          return <Trans i18nKey="common.tooltip" />
        }
      `)

      expect([...collectUsedI18nKeysFromSource(sourceFile, localeKeys)].sort()).toEqual([
        'agent.title',
        'common.cancel',
        'common.count_one',
        'common.count_other',
        'common.save',
        'common.tooltip',
        'openclaw.migration.title',
        'openclaw.not_installed.title',
        'paintings.zhipu.image_sizes.1024x1024_default',
        'settings.title',
        'trace.title'
      ])
    })

    it('preserves matching dynamic template keys and exact key strings in source text', () => {
      const localeKeys = new Set(['common.cancel', 'common.dynamic', 'settings.title'])
      const sourceFile = createSourceFile(`
        const key = 'common.dynamic'
        const label = t(key)
        const dynamic = t(\`common.\${name}\`)
        const config = { route: 'settings.title' }
      `)

      expect([...collectUsedI18nKeysFromSource(sourceFile, localeKeys)].sort()).toEqual([
        'common.cancel',
        'common.dynamic',
        'settings.title'
      ])
    })

    it('extracts namespace property access and i18n label key map values', () => {
      const localeKeys = new Set(['appMenu.about', 'provider.openai', 'provider.unused'])
      const sourceFile = createSourceFile(
        `
          const label = appMenu.about
          const providerKeyMap = { openai: 'provider.openai', unused: 'provider.missing' }
        `,
        '/repo/src/renderer/i18n/label.ts'
      )

      expect([...collectUsedI18nKeysFromSource(sourceFile, localeKeys)].sort()).toEqual([
        'appMenu.about',
        'provider.openai'
      ])
    })

    it('conservatively preserves keys that match static template-expression namespaces', () => {
      const localeKeys = new Set([
        'richEditor.commands.bold.description',
        'richEditor.commands.bold.title',
        'richEditor.toolbar.bold'
      ])
      const sourceFile = createSourceFile(`
        const key = \`richEditor.commands.\${item.id}.\${field}\`
        const label = t(key)
      `)

      expect([...collectUsedI18nKeysFromSource(sourceFile, localeKeys)].sort()).toEqual([
        'richEditor.commands.bold.description',
        'richEditor.commands.bold.title'
      ])
    })
  })

  describe('collectUsedI18nKeys', () => {
    it('derives settings shortcut keys from shortcut definitions', () => {
      const usedKeys = collectUsedI18nKeys([], new Set(['settings.shortcuts.show_app', 'settings.shortcuts.missing']))

      expect([...usedKeys]).toContain('settings.shortcuts.show_app')
      expect([...usedKeys]).not.toContain('settings.shortcuts.missing')
    })
  })

  describe('findSourceFiles', () => {
    it('includes app source directories named translate', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-unused-'))
      const translateDir = path.join(root, 'pages/translate')
      fs.mkdirSync(translateDir, { recursive: true })
      fs.writeFileSync(path.join(translateDir, 'TranslatePage.tsx'), "t('translate.detected.language')", 'utf-8')

      expect(findSourceFiles(root).map((file) => path.relative(root, file))).toEqual([
        path.join('pages', 'translate', 'TranslatePage.tsx')
      ])
    })
  })

  describe('runCli', () => {
    it('checks and cleans renderer and main catalogs against their own source scopes', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-unused-catalogs-'))
      const rendererLocalesDir = path.join(root, 'renderer/locales')
      const rendererSourceDir = path.join(root, 'renderer/source')
      const mainLocalesDir = path.join(root, 'main/locales')
      const mainSourceDir = path.join(root, 'main/source')
      const rendererLocale = {
        'catalog.shared': 'Renderer shared',
        'renderer.unused': 'Renderer unused'
      }
      const mainLocale = {
        'catalog.shared': 'Main shared',
        'main.unused': 'Main unused',
        'main.used': 'Main used',
        'main.used_one': 'Main used singular'
      }

      for (const [localesDir, locale] of [
        [rendererLocalesDir, rendererLocale],
        [mainLocalesDir, mainLocale]
      ] as const) {
        fs.mkdirSync(localesDir, { recursive: true })
        fs.writeFileSync(path.join(localesDir, 'en-us.json'), JSON.stringify(locale), 'utf-8')
        fs.writeFileSync(path.join(localesDir, 'zh-cn.json'), JSON.stringify(locale), 'utf-8')
      }
      fs.mkdirSync(rendererSourceDir, { recursive: true })
      fs.mkdirSync(mainSourceDir, { recursive: true })
      const rendererSourceFile = path.join(rendererSourceDir, 'renderer.ts')
      fs.writeFileSync(rendererSourceFile, "t('catalog.shared'); t('renderer.unused')", 'utf-8')
      fs.writeFileSync(path.join(mainSourceDir, 'main.ts'), "import { t } from '@main/i18n'; t('main.used')", 'utf-8')
      fs.writeFileSync(path.join(mainSourceDir, 'unrelated.ts'), "const key = 'catalog.shared'", 'utf-8')
      const mainTestsDir = path.join(mainSourceDir, '__tests__')
      fs.mkdirSync(mainTestsDir, { recursive: true })
      fs.writeFileSync(
        path.join(mainTestsDir, 'main.test.ts'),
        "import { t } from '@main/i18n'; t('main.unused')",
        'utf-8'
      )

      const catalogs: I18nCatalogConfig[] = [
        { name: 'renderer', localesDir: rendererLocalesDir, sourceDirs: [rendererSourceDir] },
        { name: 'main', localesDir: mainLocalesDir, sourceDirs: [mainSourceDir] }
      ]
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

      try {
        await expect(runCli({ failOnUnused: true }, catalogs)).rejects.toThrow(
          'Found 3 unused i18n keys in the main catalog.'
        )
        fs.writeFileSync(rendererSourceFile, "t('catalog.shared')", 'utf-8')
        await runCli({ all: true, clean: true }, catalogs)
      } finally {
        consoleSpy.mockRestore()
      }

      for (const locale of ['en-us', 'zh-cn']) {
        expect(JSON.parse(fs.readFileSync(path.join(rendererLocalesDir, `${locale}.json`), 'utf-8'))).toEqual({
          'catalog.shared': 'Renderer shared'
        })
        expect(JSON.parse(fs.readFileSync(path.join(mainLocalesDir, `${locale}.json`), 'utf-8'))).toEqual({
          'main.used': 'Main used'
        })
      }
    })
  })

  describe('createUnusedI18nResult', () => {
    it('reports keys that are not statically referenced', () => {
      const locale: I18N = { 'common.cancel': '取消', 'common.save': '保存' }
      const result = createUnusedI18nResult(locale, ['common.save'])

      expect(result.unusedKeys).toEqual(['common.cancel'])
      expect(result.groupedUnusedKeys).toEqual({ common: ['common.cancel'] })
    })
  })

  describe('assertNoUnusedI18nKeys', () => {
    it('rejects catalogs that contain unused keys', () => {
      const result = createUnusedI18nResult({ 'common.cancel': 'Cancel', 'common.save': 'Save' }, ['common.save'])

      expect(() => assertNoUnusedI18nKeys(result)).toThrow(
        'Found 1 unused i18n key. Run `pnpm i18n:unused` to review it.'
      )
    })

    it('accepts catalogs without unused keys', () => {
      const result = createUnusedI18nResult({ 'common.save': 'Save' }, ['common.save'])

      expect(() => assertNoUnusedI18nKeys(result)).not.toThrow()
    })
  })

  describe('selectKeysByGroups', () => {
    it('selects unused keys by top-level namespace', () => {
      expect(
        selectKeysByGroups(
          {
            common: ['common.cancel'],
            settings: ['settings.title'],
            translate: ['translate.title']
          },
          ['common', 'translate']
        )
      ).toEqual(['common.cancel', 'translate.title'])
    })
  })

  describe('removeI18nKeys', () => {
    it('removes the selected keys and leaves the rest sorted', () => {
      const locale: I18N = {
        'settings.title': '设置',
        'common.save': '保存',
        'common.cancel': '取消',
        'settings.nested.unused': '未使用'
      }

      expect(removeI18nKeys(locale, ['common.cancel', 'settings.nested.unused'])).toEqual({
        'common.save': '保存',
        'settings.title': '设置'
      })
    })
  })
})
