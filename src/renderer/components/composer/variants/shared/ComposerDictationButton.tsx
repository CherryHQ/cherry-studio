import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { BarVisualizer, Button, Tooltip } from '@cherrystudio/ui'
import { useDictationLauncher } from '@renderer/components/composer/tools/definitions/dictationTool'
import { type QuickPanelInputAdapter, useQuickPanel } from '@renderer/components/QuickPanel'
import { useMinimalMode } from '@renderer/hooks/useMinimalMode'
import { cn } from '@renderer/utils/style'

import { COMPOSER_SEND_ACCESSORY_BUTTON_CLASS } from './ComposerControlScaffolding'

export function ComposerDictationButton({ inputAdapter }: { inputAdapter?: QuickPanelInputAdapter }) {
  const { t } = useTranslation()
  const minimalMode = useMinimalMode()
  const quickPanel = useQuickPanel()
  const { launcher, snapshot } = useDictationLauncher(t)
  const { label } = launcher
  const capturing = ['starting', 'recording', 'stopping', 'transcribing'].includes(snapshot.phase)
  const discardLauncher =
    snapshot.phase === 'recorded' || snapshot.retryAvailable || snapshot.recoveryAvailable
      ? launcher.submenu?.find((item) => item.id === 'dictation:discard')
      : undefined

  if (launcher.hidden) return null

  return (
    <div
      className={
        capturing
          ? 'flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-popover py-0.5 pr-0.5 pl-3'
          : 'flex shrink-0 items-center gap-1.5'
      }>
      {snapshot.transcript && (
        <span role="status" className="max-w-64 truncate text-sm" title={snapshot.transcript.text}>
          {snapshot.transcript.text.slice(0, snapshot.transcript.provisionalStart)}
          <span className="text-muted-foreground">
            {snapshot.transcript.text.slice(snapshot.transcript.provisionalStart)}
          </span>
        </span>
      )}
      {capturing && (
        <BarVisualizer
          aria-hidden
          analyser={snapshot.analyser}
          state={snapshot.phase === 'recording' ? 'listening' : undefined}
          className="h-5 w-16"
        />
      )}
      {capturing && launcher.suffix ? (
        <span className="text-xs text-muted-foreground tabular-nums">{launcher.suffix}</span>
      ) : null}
      <Tooltip
        content={
          <>
            {label}
            {launcher.description ? <div role="status">{launcher.description}</div> : null}
          </>
        }>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            COMPOSER_SEND_ACCESSORY_BUTTON_CLASS,
            minimalMode?.enabled && minimalMode.isHome && 'text-foreground!',
            '[&>svg]:!size-4.5'
          )}
          aria-label={typeof label === 'string' ? label : undefined}
          data-active={launcher.active || undefined}
          disabled={launcher.disabled}
          onClick={() => launcher.action?.({ quickPanel, source: 'root-panel', inputAdapter })}>
          {launcher.icon}
        </Button>
      </Tooltip>
      {discardLauncher && (
        <Tooltip content={discardLauncher.label}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={COMPOSER_SEND_ACCESSORY_BUTTON_CLASS}
            aria-label={typeof discardLauncher.label === 'string' ? discardLauncher.label : undefined}
            onClick={() => discardLauncher.action?.({ quickPanel, source: 'root-panel', inputAdapter })}>
            <X className="size-4" />
          </Button>
        </Tooltip>
      )}
    </div>
  )
}
