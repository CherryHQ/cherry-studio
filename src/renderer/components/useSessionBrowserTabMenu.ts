import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import type { CommandContextMenuExtraItem } from '@renderer/components/command'
import { useOptionalTabsContext } from '@renderer/hooks/tab'
import { useWindowFrame } from '@renderer/hooks/useWindowFrame'
import { ipcApi } from '@renderer/ipc'
import type { AgentBrowserRuntimeService } from '@renderer/services/AgentBrowserRuntimeService'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { openExternalWebsite } from '@renderer/services/website'
import { isHttpUrl } from '@shared/utils/url'

const logger = loggerService.withContext('SessionBrowserTabMenu')

export function useSessionBrowserTabMenu({
  runtime: browserRuntime,
  sessionId
}: {
  runtime: AgentBrowserRuntimeService
  sessionId: string
}) {
  const { t } = useTranslation()
  const tabs = useOptionalTabsContext()
  const frame = useWindowFrame()
  const title = (page: NonNullable<ReturnType<AgentBrowserRuntimeService['get']>>) =>
    page.title || (page.url === 'about:blank' ? t('webview.tabs.new') : page.url)
  const getMenuItems = (pageId: string): readonly CommandContextMenuExtraItem[] => {
    const page = browserRuntime.get(sessionId, pageId)
    if (!page) return []
    const openElsewhere = (destination: 'tab' | 'window') => {
      const current = browserRuntime.get(sessionId, pageId)
      if (!current) return
      const url = `/app/browser?${new URLSearchParams({ url: current.url })}`
      if (destination === 'window') {
        void ipcApi
          .request('tab.detach', { id: crypto.randomUUID(), url, title: title(current), type: 'route' })
          .catch((error) => logger.error('Failed to open browser tab in a new window', error))
      } else if (tabs && frame.mode === 'embedded') {
        tabs.openTab(url, { title: title(current), forceNew: true })
      } else {
        openRoute('/app/browser', { url: current.url })
      }
    }
    return [
      {
        type: 'item',
        id: 'browser.tab.open-new-tab',
        label: t('common.open_in_new_tab'),
        onSelect: () => openElsewhere('tab')
      },
      {
        type: 'item',
        id: 'browser.tab.open-new-window',
        label: t('tab.open_in_new_window'),
        onSelect: () => openElsewhere('window')
      },
      {
        type: 'item',
        id: 'browser.tab.copy-link',
        label: t('webview.tabs.copy_link'),
        enabled: page.url !== 'about:blank',
        onSelect: () => {
          const current = browserRuntime.get(sessionId, pageId)
          if (!current || current.url === 'about:blank') return
          void navigator.clipboard.writeText(current.url).then(
            () => toast.success(t('message.copy.success')),
            (error) => {
              logger.error('Failed to copy browser tab link', error)
              toast.error(t('common.copy_failed'))
            }
          )
        }
      },
      {
        type: 'item',
        id: 'browser.tab.open-external',
        label: t('webview.navigation.open_external'),
        enabled: isHttpUrl(page.url),
        onSelect: () => {
          const current = browserRuntime.get(sessionId, pageId)
          if (current && isHttpUrl(current.url))
            void openExternalWebsite(current.url).catch((error) =>
              logger.error('Failed to open browser tab externally', error)
            )
        }
      }
    ]
  }
  return getMenuItems
}
