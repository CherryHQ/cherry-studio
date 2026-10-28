// Asks the browser to keep the site's storage. Without it the browser may delete the account's OPFS
// data under storage pressure, and until backup exists nothing restores it.
import { pageNotices } from './pageNotices'

const resources = {
  en: {
    translation: {
      title: 'The browser may delete your data',
      description:
        'The browser did not agree to keep Cherry Studio’s data. It may delete it when your disk runs low. Do not clear this site’s data.'
    }
  },
  'zh-CN': {
    translation: {
      title: '浏览器可能会删除你的数据',
      description: '浏览器没有同意保留 Cherry Studio 的数据，磁盘空间不足时可能会删除它。请不要清除这个站点的数据。'
    }
  },
  'zh-TW': {
    translation: {
      title: '瀏覽器可能會刪除你的資料',
      description: '瀏覽器沒有同意保留 Cherry Studio 的資料，磁碟空間不足時可能會刪除它。請不要清除這個網站的資料。'
    }
  }
}

/** Asks for persistent storage and warns once per account when the browser refuses. */
export async function requestPersistentStorage(account: string): Promise<void> {
  if ((await navigator.storage.persisted()) || (await navigator.storage.persist())) return
  const key = `cherry-studio:storage-warning:${account}`
  try {
    if (localStorage.getItem(key)) return
    localStorage.setItem(key, String(Date.now()))
  } catch {
    // Without localStorage the warning shows on every visit, which is still better than never.
  }
  const { toast, t } = await pageNotices(resources)
  // Long enough to read, without covering the page for good: most first visits in Chrome are refused.
  toast.warning({ title: t('title'), description: t('description'), timeout: 15_000 })
}
