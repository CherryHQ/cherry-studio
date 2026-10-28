// Replaces the loading spinner when the account cannot open. The renderer's i18n reads the language
// from preferences in that database, so this screen has its own strings, as the desktop's pre-boot windows do.
import i18next from 'i18next'

const resources = {
  en: {
    translation: {
      locked: 'Cherry Studio is already open in another tab. Close that tab, then reload this page.',
      unsupported: 'This browser cannot run Cherry Studio. Use a current version of Chrome, Edge, Firefox or Safari.',
      isolation:
        'This site is not set up to run Cherry Studio: it must be served with the Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers. Contact the site administrator.',
      storage:
        'This browser does not let Cherry Studio store data on this site, as in some private windows. Open the site in a normal window.',
      failed: 'Cherry Studio could not start: {{message}}',
      reload: 'Reload'
    }
  },
  'zh-CN': {
    translation: {
      locked: 'Cherry Studio 已在另一个标签页中打开。请关闭那个标签页，然后重新加载本页。',
      unsupported: '当前浏览器无法运行 Cherry Studio。请使用最新版本的 Chrome、Edge、Firefox 或 Safari。',
      isolation:
        '这个站点没有按 Cherry Studio 的要求部署：页面必须带 Cross-Origin-Opener-Policy 和 Cross-Origin-Embedder-Policy 响应头。请联系站点管理员。',
      storage: '当前浏览器不允许 Cherry Studio 在这个站点存储数据，某些无痕窗口就是这样。请在普通窗口中打开。',
      failed: 'Cherry Studio 无法启动：{{message}}',
      reload: '重新加载'
    }
  },
  'zh-TW': {
    translation: {
      locked: 'Cherry Studio 已在另一個分頁中開啟。請關閉那個分頁，然後重新載入本頁。',
      unsupported: '目前的瀏覽器無法執行 Cherry Studio。請使用最新版本的 Chrome、Edge、Firefox 或 Safari。',
      isolation:
        '這個網站沒有按 Cherry Studio 的要求部署：頁面必須帶 Cross-Origin-Opener-Policy 和 Cross-Origin-Embedder-Policy 回應標頭。請聯絡網站管理員。',
      storage: '目前的瀏覽器不允許 Cherry Studio 在這個網站儲存資料，某些無痕視窗就是這樣。請在一般視窗中開啟。',
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

  const known: Record<string, string> = {
    DatabaseLockedError: 'locked',
    BrowserUnsupportedError: 'unsupported',
    CrossOriginIsolationError: 'isolation',
    StorageUnavailableError: 'storage'
  }
  const message = document.createElement('p')
  message.textContent = error.name in known ? i18n.t(known[error.name]) : i18n.t('failed', { message: error.message })
  const reload = document.createElement('button')
  reload.textContent = i18n.t('reload')
  reload.onclick = () => location.reload()
  document.getElementById('spinner')?.replaceChildren(message, reload)
}
