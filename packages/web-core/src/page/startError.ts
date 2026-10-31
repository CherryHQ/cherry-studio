// Replaces the loading spinner when the account cannot open. The renderer's i18n reads the language
// from preferences in that database, so this screen has its own strings, as the desktop's pre-boot windows do.
import i18next from 'i18next'

const resources = {
  en: {
    translation: {
      locked: 'Cherry Studio is already open in another tab. Close that tab, then reload this page.',
      failed: 'Cherry Studio could not start: {{message}}',
      reload: 'Reload'
    }
  },
  'zh-CN': {
    translation: {
      locked: 'Cherry Studio 已在另一个标签页中打开。请关闭那个标签页，然后重新加载本页。',
      failed: 'Cherry Studio 无法启动：{{message}}',
      reload: '重新加载'
    }
  },
  'zh-TW': {
    translation: {
      locked: 'Cherry Studio 已在另一個分頁中開啟。請關閉那個分頁，然後重新載入本頁。',
      failed: 'Cherry Studio 無法啟動：{{message}}',
      reload: '重新載入'
    }
  }
}

function detectLanguage(): keyof typeof resources {
  const language = (navigator.language || 'en').toLowerCase()
  if (language.includes('zh-tw') || language.includes('zh-hk')) return 'zh-TW'
  if (language.includes('zh')) return 'zh-CN'
  return 'en'
}

/** Shows why the app did not start, with a reload button. */
export async function showStartError(error: Error): Promise<void> {
  const i18n = i18next.createInstance()
  await i18n.init({ resources, lng: detectLanguage(), fallbackLng: 'en', interpolation: { escapeValue: false } })

  const message = document.createElement('p')
  message.textContent =
    error.name === 'DatabaseLockedError' ? i18n.t('locked') : i18n.t('failed', { message: error.message })
  const reload = document.createElement('button')
  reload.textContent = i18n.t('reload')
  reload.onclick = () => location.reload()
  document.getElementById('spinner')?.replaceChildren(message, reload)
}
