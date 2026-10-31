import { ChevronDown, ExternalLink, Loader2, Play, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ButtonGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip
} from '@cherrystudio/ui'

const buttonClass = 'h-8 rounded-lg border-border-subtle text-xs shadow-none'
const iconClass = 'lucide-custom size-3.5 text-muted-foreground'

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
  return (
    <ButtonGroup className="shrink-0" aria-label={t('code.web_ui.actions')}>
      <Button
        variant="outline"
        size="sm"
        className={buttonClass}
        disabled={disabled || pending}
        onClick={running ? onOpen : onStart}>
        {pending ? (
          <Loader2 className={`${iconClass} animate-spin`} />
        ) : running ? (
          <ExternalLink className={iconClass} />
        ) : (
          <Play className={iconClass} />
        )}
        {t(running ? 'code.open_web_ui' : 'code.web_ui.start')}
      </Button>
      {running && onStop && (
        <DropdownMenu>
          <Tooltip content={t('code.web_ui.actions')} asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={`${buttonClass} w-7 px-0`}
                disabled={disabled || pending}
                aria-label={t('code.web_ui.actions')}>
                <ChevronDown className={iconClass} />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end" className="rounded-lg p-1">
            <DropdownMenuItem disabled={disabled || pending} onSelect={onStop} className="rounded-md text-xs">
              <Square className={iconClass} />
              {t('code.web_ui.stop')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </ButtonGroup>
  )
}
