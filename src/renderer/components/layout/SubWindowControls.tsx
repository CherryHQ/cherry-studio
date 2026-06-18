import { Tooltip } from '@cherrystudio/ui'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { cn } from '@renderer/utils'
import { Pin } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Detached-window navbar control: pin (always-on-top). Rendered by ConversationShell
 * only when the page lives in a sub-window, immediately left of the page's right-side tool.
 */
export const SubWindowControls = () => {
  const { t } = useTranslation()
  const [pinned, setPinned] = useState(false)

  const handleTogglePin = async () => {
    const next = !pinned
    const ok = await window.api.window.setAlwaysOnTop(next)
    if (ok) setPinned(next)
  }

  const pinLabel = pinned ? t('subWindow.unpin') : t('subWindow.pin')

  return (
    <Tooltip placement="bottom" content={pinLabel} delay={400}>
      <NavbarIcon
        aria-label={pinLabel}
        aria-pressed={pinned}
        onClick={handleTogglePin}
        className={cn(pinned && 'text-primary! hover:text-primary!')}>
        <Pin className={pinned ? 'fill-current' : undefined} />
      </NavbarIcon>
    </Tooltip>
  )
}
