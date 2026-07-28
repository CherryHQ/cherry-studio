import { Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { BackToMainWindowIcon } from '@renderer/components/icons/WindowIcons'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { useTabs } from '@renderer/hooks/tab'
import { ipcApi } from '@renderer/ipc'
import { resolveSidebarAppTabEntryUrl } from '@renderer/utils/sidebar'
import { cn } from '@renderer/utils/style'
import { Pin } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('SubWindowControls')

/**
 * Detached-window title-bar controls: pin (always-on-top) + back-to-main. Self-contained —
 * the back action re-attaches the window's single tab via the tab IPC API (SubWindowService
 * closes this window after broadcasting).
 */
export const SubWindowControls = () => {
  const { t } = useTranslation()
  const { tabs, activeTabId } = useTabs()
  const [pinned, setPinned] = useState(false)

  const handleTogglePin = async () => {
    const next = !pinned
    const ok = await ipcApi.request('window.sub.set_always_on_top', next)
    if (ok) setPinned(next)
  }

  const handleBackToMain = () => {
    const tab = tabs.find((tabItem) => tabItem.id === activeTabId) ?? tabs[0]
    if (!tab) return
    const payload = { ...tab, url: resolveSidebarAppTabEntryUrl(tab) }
    ipcApi.request('tab.attach', payload).catch((err) => {
      logger.error('Back to main window failed', err as Error)
    })
  }

  const pinLabel = pinned ? t('subWindow.unpin') : t('subWindow.pin')

  return (
    <>
      <Tooltip placement="bottom" content={pinLabel} delay={400}>
        <NavbarIcon
          aria-label={pinLabel}
          aria-pressed={pinned}
          onClick={handleTogglePin}
          className={cn(pinned && 'text-primary! hover:text-primary!')}>
          <Pin className={pinned ? 'fill-current' : undefined} />
        </NavbarIcon>
      </Tooltip>
      <Tooltip placement="bottom" content={t('subWindow.back_to_main')} delay={400}>
        <NavbarIcon aria-label={t('subWindow.back_to_main')} onClick={handleBackToMain}>
          <BackToMainWindowIcon />
        </NavbarIcon>
      </Tooltip>
    </>
  )
}
