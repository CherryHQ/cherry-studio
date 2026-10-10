/**
 * The toolbar's OCR affordance: one icon whose glyph, tooltip and clickability
 * all follow the recognition status.
 *
 * Three different "looks like a button" mechanisms are in play and none is
 * interchangeable: a genuinely clickable button, a natively `disabled` one that
 * keeps pointer events only so its tooltip still opens, and an action-less shell
 * for the states with nothing to do. Collapsing them loses either the tooltip or
 * the affordance.
 */

import { CircleAlert, Download, LoaderCircle, ScanText, TextSearch } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, NormalTooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ipcApi } from '@renderer/ipc'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'

import type { OcrStatus } from '../hooks/useOcr'

interface OcrStatusIconProps {
  status: OcrStatus
  /** Only meaningful with `status: 'error'`; falls back to a generic message. */
  errorMessage?: string
  onCopyText?: () => void
  onTriggerOcr?: () => void
  /**
   * Annotation mode. Orthogonal to `status`: the text layer must not steal the
   * annotation tools' pointer events, so the affordance greys out whatever the
   * recognition is doing.
   */
  disabled?: boolean
  /** Off means recognition waits for a click, which the resting glyph reflects. */
  autoOcr?: boolean
}

/** Matches the toolbar's own controls: its flip maths is derived from a 32 px button. */
const BUTTON_CLASS = 'size-8'

/** Open the local-model settings and take the overlay down on the way. */
function goToModelSettings(): void {
  // Cancel first: the screen-saver-level overlay would otherwise cover the page we navigate to.
  // Neither call is awaited — the message only has to leave before the window is hidden.
  void ipcApi.request('screenshot.cancel')
  openSettingsTab('/settings/local-models')
}

export function OcrStatusIcon({
  status,
  errorMessage,
  onCopyText,
  onTriggerOcr,
  disabled,
  autoOcr
}: OcrStatusIconProps) {
  const { t } = useTranslation()

  if (disabled) {
    const DisabledIcon = autoOcr === false ? TextSearch : ScanText
    const label = t('screenshot.ocr.disabled_while_annotating')
    return (
      <NormalTooltip content={label} side="bottom">
        <Button
          variant="ghost"
          size="icon"
          // The pointer-events override is the whole point: a natively disabled
          // control swallows hover, and the tooltip is the only explanation there is.
          className={cn(
            BUTTON_CLASS,
            'disabled:pointer-events-auto disabled:cursor-default disabled:hover:bg-transparent'
          )}
          aria-label={label}
          disabled>
          <DisabledIcon className="size-5" />
        </Button>
      </NormalTooltip>
    )
  }

  switch (status) {
    case 'idle':
      return null
    case 'pending':
      return (
        <ActionIcon
          label={t('screenshot.ocr.recognize')}
          icon={<TextSearch className="size-5" />}
          onClick={onTriggerOcr}
        />
      )
    case 'done':
      return <ActionIcon label={t('screenshot.ocr.copy')} icon={<ScanText className="size-5" />} onClick={onCopyText} />
    case 'unavailable':
      return (
        <ActionIcon
          label={t('screenshot.ocr.unavailable')}
          icon={<BadgedIcon badge={<Download className="size-3" />} />}
          onClick={goToModelSettings}
        />
      )
    case 'recognizing':
      // Indeterminate on purpose: nothing in the worker protocol reports OCR
      // progress, and an invented percentage is worse than none.
      return (
        <InertIcon
          label={t('screenshot.ocr.recognizing')}
          icon={<LoaderCircle className="size-5 animate-spin text-muted-foreground" />}
        />
      )
    case 'error':
      // No retry by design — nudging the selection re-triggers recognition.
      return (
        <InertIcon
          label={errorMessage || t('screenshot.ocr.failed')}
          icon={<BadgedIcon badge={<CircleAlert className="size-3 text-destructive" />} />}
        />
      )
  }
}

/** The clickable shape: `pending`, `done` and `unavailable` all use it. */
function ActionIcon({ label, icon, onClick }: { label: string; icon: ReactNode; onClick?: () => void }) {
  return (
    <NormalTooltip content={label} side="bottom">
      <Button
        variant="ghost"
        size="icon"
        className={cn(BUTTON_CLASS, 'text-popover-foreground')}
        aria-label={label}
        onClick={onClick}>
        {icon}
      </Button>
    </NormalTooltip>
  )
}

/** A real button with no action: it exists to carry the tooltip, nothing else. */
function InertIcon({ label, icon }: { label: string; icon: ReactNode }) {
  return (
    <NormalTooltip content={label} side="bottom" contentProps={{ className: 'line-clamp-2' }}>
      <Button
        variant="ghost"
        size="icon"
        className={cn(BUTTON_CLASS, 'cursor-default hover:bg-transparent')}
        aria-label={label}>
        {icon}
      </Button>
    </NormalTooltip>
  )
}

/** The resting glyph, dimmed, with a small status badge in its corner. */
function BadgedIcon({ badge }: { badge: ReactNode }) {
  return (
    <span className="relative size-5">
      <ScanText className="size-5 text-muted-foreground opacity-50" />
      <span className="-right-0.5 -bottom-0.5 absolute rounded-full backdrop-blur-lg">{badge}</span>
    </span>
  )
}
