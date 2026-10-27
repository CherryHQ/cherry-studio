import { CircleArrowLeft, Loader2, Pin, Save } from 'lucide-react'
import type { ButtonHTMLAttributes, FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'

const logger = loggerService.withContext('QuickAssistantControlBar')

interface Props {
  loading: boolean
  isPinned: boolean
  topicId: string | null
  topicTitle: string
  onEsc: () => void
  onSetPinned: (isPinned: boolean) => void
  /** Moves the temporary conversation into SQLite. Resolves once it is a real topic. */
  onPersist: () => Promise<void>
}

/**
 * Panel title bar. The conversation lives in memory until "save as topic" is pressed.
 *
 * Saving is blocked while a turn streams: `TemporaryChatContextProvider.canHandle` runs
 * once per dispatch, so an in-flight stream keeps the temporary backend it was bound to
 * and its terminal append would fail against a topic persist has already removed from
 * the map — saving the conversation without the answer being written.
 */
const ControlBar: FC<Props> = ({ loading, isPinned, topicId, topicTitle, onEsc, onSetPinned, onPersist }) => {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)

  const persist = useCallback(async () => {
    if (saving) return
    setSaving(true)
    try {
      await onPersist()
    } catch (error) {
      logger.error('Failed to persist the quick assistant conversation', error as Error)
      toast.error(t('quickAssistant.control_bar.save_failed'))
    } finally {
      setSaving(false)
    }
  }, [onPersist, saving, t])

  const escLabel = t('quickAssistant.footer.esc', {
    action: loading ? t('quickAssistant.footer.esc_pause') : t('quickAssistant.footer.esc_back')
  })

  return (
    <header
      data-ui="quick-assistant.titlebar"
      className="flex h-10 shrink-0 items-center border-border-subtle border-b px-2 [-webkit-app-region:drag]">
      <div className="flex min-w-0 flex-1 items-center gap-2 px-1.5">
        <span className="truncate font-medium text-foreground text-sm">{topicTitle}</span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
        <Action label={escLabel} onClick={onEsc}>
          {loading ? (
            <Loader2 size={12} className="animate-spin text-error" />
          ) : (
            <CircleArrowLeft size={14} className="text-foreground" />
          )}
        </Action>
        <Action
          label={t('quickAssistant.control_bar.save_topic')}
          onClick={() => void persist()}
          disabled={saving || loading || !topicId}>
          <Save size={14} className="text-foreground" />
        </Action>
        <Action label={t('quickAssistant.tooltip.pin')} onClick={() => onSetPinned(!isPinned)} aria-pressed={isPinned}>
          <Pin
            size={14}
            className={cn('transition-transform', isPinned ? 'rotate-[40deg] text-primary' : 'text-foreground')}
          />
        </Action>
      </div>
    </header>
  )
}

const Action: FC<ButtonHTMLAttributes<HTMLButtonElement> & { label: string }> = ({
  children,
  className,
  label,
  ...props
}) => (
  <Tooltip placement="bottom" content={label} delay={600}>
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn('rounded-full text-muted-foreground hover:text-foreground active:scale-[0.96]', className)}
      aria-label={label}
      {...props}>
      {children}
    </Button>
  </Tooltip>
)

export default ControlBar
