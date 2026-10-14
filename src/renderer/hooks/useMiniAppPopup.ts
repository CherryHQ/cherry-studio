import { useCallback } from 'react'

import { cacheService } from '@renderer/data/CacheService'
import { useCache } from '@renderer/data/hooks/useCache'
import { useOptionalTabsContext } from '@renderer/hooks/tab'
import { ipcApi } from '@renderer/ipc'
import type { MiniAppInput } from '@renderer/utils/miniAppDescriptor'
import type { MiniApp } from '@shared/data/types/miniApp'
import { fileUrlToPath } from '@shared/utils/file'

export { toTransientMiniApp } from '@renderer/utils/miniAppDescriptor'

function openExternalMiniAppUrl(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') {
      void ipcApi.request('system.shell.open_path', fileUrlToPath(parsed))
      return
    }
  } catch {
    // Fall through to openWebsite so the existing main-process URL guard handles it.
  }

  void ipcApi.request('system.shell.open_external_website', url)
}

export const useMiniAppPopup = () => {
  const tabs = useOptionalTabsContext()
  const openTab = tabs?.openTab
  const [, setSplit] = useCache('mini_app.split')
  const openMiniAppInSplit = useCallback((app: MiniApp) => setSplit({ appId: app.appId }), [setSplit])
  const openSmartMiniApp = useCallback(
    (config: MiniAppInput) => {
      if (!openTab) return openExternalMiniAppUrl(config.url)
      cacheService.setShared(`mini_app.transient_descriptor.${config.appId}`, config)
      openTab(`/app/mini-app/${config.appId}`, {
        title: config.name,
        icon: config.logoSrc ?? config.logo,
        metadata: { transientMiniApp: true }
      })
    },
    [openTab]
  )
  const openSplit = useCallback(() => setSplit({ appId: null }), [setSplit])
  const closeSplit = useCallback(() => setSplit(null), [setSplit])
  return { openMiniAppInSplit, openSmartMiniApp, openSplit, closeSplit }
}
