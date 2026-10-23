// Toasts from page code outside the renderer. The renderer catalog is desktop code, so like the start
// screen each caller keeps its own strings; they follow the renderer's current language.
import i18next, { type Resource, type TFunction } from 'i18next'

export async function pageNotices(resources: Resource) {
  const [{ toast }, { default: rendererI18n }] = await Promise.all([
    import('@renderer/services/toast'),
    import('@renderer/i18n/resolver')
  ])
  const language = rendererI18n.language.toLowerCase()
  const lng = language === 'zh-tw' || language === 'zh-hk' ? 'zh-TW' : language.startsWith('zh') ? 'zh-CN' : 'en'
  const i18n = i18next.createInstance()
  await i18n.init({ resources, lng, fallbackLng: 'en', interpolation: { escapeValue: false } })
  return { toast, t: i18n.t.bind(i18n) as TFunction }
}
