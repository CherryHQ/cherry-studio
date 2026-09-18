import { Shuffle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { usePreference } from '@data/hooks/usePreference'

/**
 * Master switch for answering with a different model when the chosen one fails or runs out of
 * quota. Off by default: a swap changes the character of the reply, so it is never silent.
 */
export const AutoSwitchToggle = () => {
  const { t } = useTranslation()
  const [enabled, setEnabled] = usePreference('chat.routing.auto_switch_enabled')

  return (
    <Tooltip content={t(enabled ? 'chat.auto_switch.on_tip' : 'chat.auto_switch.off_tip')}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-pressed={enabled}
        aria-label={t('chat.auto_switch.label')}
        className={cn('size-7 rounded-lg', enabled ? 'text-primary' : 'text-muted-foreground')}
        onClick={() => void setEnabled(!enabled)}>
        <Shuffle className="size-4" />
      </Button>
    </Tooltip>
  )
}
