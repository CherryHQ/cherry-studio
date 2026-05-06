import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Project } from 'ts-morph'

import {
  collectUsedI18nKeys,
  collectUsedI18nKeysFromSource,
  createUnusedI18nResult,
  findSourceFiles,
  flattenI18nKeys,
  type I18N,
  removeI18nKeys,
  selectKeysByGroups
} from '../check-unused-i18n'

function createSourceFile(code: string, filePath = 'test.tsx') {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { jsx: 2 }
  })

  return project.createSourceFile(filePath, code, { overwrite: true })
}

describe('check-unused-i18n', () => {
  describe('flattenI18nKeys', () => {
    it('flattens nested locale keys into dotted keys', () => {
      const locale: I18N = {
        common: {
          cancel: '取消',
          nested: {
            save: '保存'
          }
        },
        settings: {
          title: '设置'
        }
      }

      expect(flattenI18nKeys(locale).sort()).toEqual(['common.cancel', 'common.nested.save', 'settings.title'])
    })
  })

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
        '/repo/src/renderer/src/i18n/label.ts'
      )

      expect([...collectUsedI18nKeysFromSource(sourceFile, localeKeys)].sort()).toEqual([
        'appMenu.about',
        'provider.openai'
      ])
    })

    it('extracts aliased namespaces destructured from i18n translations', () => {
      const localeKeys = new Set(['selection.name', 'tray.quit', 'tray.show_quick_assistant', 'tray.show_window'])
      const sourceFile = createSourceFile(`
        const i18n = getI18n()
        const { tray: trayLocale, selection: selectionLocale } = i18n.translation
        const menu = [
          { label: trayLocale.show_window },
          { label: trayLocale.show_quick_assistant },
          { label: selectionLocale.name },
          { label: trayLocale.quit }
        ]
      `)

      expect([...collectUsedI18nKeysFromSource(sourceFile, localeKeys)].sort()).toEqual([
        'selection.name',
        'tray.quit',
        'tray.show_quick_assistant',
        'tray.show_window'
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
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unused-i18n-'))
      const translateDir = path.join(root, 'pages/translate')
      fs.mkdirSync(translateDir, { recursive: true })
      fs.writeFileSync(path.join(translateDir, 'TranslatePage.tsx'), "t('translate.detected.language')", 'utf-8')

      expect(findSourceFiles(root).map((file) => path.relative(root, file))).toEqual([
        path.join('pages', 'translate', 'TranslatePage.tsx')
      ])
    })
  })

  describe('createUnusedI18nResult', () => {
    it('reports keys that are not statically referenced', () => {
      const locale: I18N = {
        common: {
          cancel: '取消',
          save: '保存'
        }
      }
      const result = createUnusedI18nResult(locale, ['common.save'])

      expect(result.unusedKeys).toEqual(['common.cancel'])
      expect(result.groupedUnusedKeys).toEqual({ common: ['common.cancel'] })
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
    it('removes selected leaf keys and prunes empty objects', () => {
      const locale: I18N = {
        common: {
          cancel: '取消',
          save: '保存'
        },
        settings: {
          nested: {
            unused: '未使用'
          },
          title: '设置'
        }
      }

      expect(removeI18nKeys(locale, ['common.cancel', 'settings.nested.unused'])).toEqual({
        common: {
          save: '保存'
        },
        settings: {
          title: '设置'
        }
      })
    })

    it('can be applied to multiple locale files consistently', () => {
      const zhCN: I18N = {
        common: {
          cancel: '取消',
          save: '保存'
        }
      }
      const enUS: I18N = {
        common: {
          cancel: 'Cancel',
          save: 'Save'
        }
      }

      expect(removeI18nKeys(zhCN, ['common.cancel'])).toEqual({ common: { save: '保存' } })
      expect(removeI18nKeys(enUS, ['common.cancel'])).toEqual({ common: { save: 'Save' } })
    })
  })
})
