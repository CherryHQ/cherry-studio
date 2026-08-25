import { defineConfig } from 'i18next-cli'

export default defineConfig({
  locales: ['en-us', 'zh-cn'],
  extract: {
    input: ['src/renderer/**/*.{tsx,ts}'],
    ignore: ['src/renderer/**/__tests__/*.{tsx,ts}', 'src/renderer/**/*.test.{tsx,ts}'],
    output: 'src/renderer/i18n/locales/{{language}}.json',
    defaultNS: false,
    // Catalogs are flat: `settings.provider.title` is one literal key, not a path.
    keySeparator: false,
    // 暂时不移除冗余键，等稳定下来后再清理
    removeUnusedKeys: false
  },
  lint: {}
})
