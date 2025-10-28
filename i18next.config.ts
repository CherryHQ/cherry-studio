import { defineConfig } from 'i18next-cli'

/** @see https://github.com/i18next/i18next-cli */
export default defineConfig({
  locales: ['en-us', 'zh-cn', 'zh-tw', 'de-de', 'el-gr', 'es-es', 'fr-fr', 'ja-jp', 'pt-pt', 'ru-ru'],
  extract: {
    input: 'src/renderer/src/**/*.{ts,tsx}',
    output: 'src/renderer/src/i18n/locales/{{language}}.json',
    defaultValue: (_1, _2, _3, value) => `[to be translated]${value}`,
    primaryLanguage: 'en-us',
    removeUnusedKeys: false
  },
  types: {
    input: ['src/renderer/src/i18n/locales/en-us.json'],
    output: 'src/renderer/src/i18n/i18next.d.ts',
    resourcesFile: 'src/renderer/src/i18n/resources.d.ts',
    enableSelector: true
  }
})
