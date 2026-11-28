import { ExternalLink, Loader2, Play, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'

const buttonClass = 'h-8 rounded-lg border-border-subtle text-xs shadow-none'
const iconClass = 'lucide-custom size-3.5'

export function AgentWebUiControl({
  disabled,
  running,
  pending,
  onStart,
  onStop,
  onOpen
}: {
  disabled: boolean
  running: boolean
  pending: boolean
  onStart: () => void
  onStop?: () => void
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const actionLabel = t(running ? 'code.web_ui.stop' : 'code.web_ui.start')
  const actionIconClass = `${iconClass} ${running ? 'text-destructive' : 'text-muted-foreground'}`
  return (
    <div className="flex shrink-0 items-center gap-2" role="group" aria-label={t('code.web_ui.actions')}>
      {(!running || onStop) && (
        <Tooltip content={actionLabel} asChild>
          <Button
            variant="outline"
            size="icon"
            className={`${buttonClass} size-8`}
            disabled={disabled || pending}
            aria-label={actionLabel}
            aria-pressed={running}
            aria-busy={pending || undefined}
            onClick={running ? onStop : onStart}>
            {pending ? (
              <Loader2 className={`${actionIconClass} animate-spin`} />
            ) : running ? (
              <Square className={actionIconClass} />
            ) : (
              <Play className={actionIconClass} />
            )}
          </Button>
        </Tooltip>
      )}
      {running && (
        <Button variant="outline" size="sm" className={buttonClass} disabled={disabled || pending} onClick={onOpen}>
          <ExternalLink className={`${iconClass} text-muted-foreground`} />
          {t('code.open_web_ui')}
        </Button>
      )}
    </div>
  )
}
