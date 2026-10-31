import { Mic, X } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { BarVisualizer, Button, Tooltip } from '@cherrystudio/ui'
import { useComposerToolLauncherController } from '@renderer/components/composer/ComposerToolRuntime'
import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
import { dictationService } from '@renderer/services/voice'

import { COMPOSER_SEND_ACCESSORY_BUTTON_CLASS } from './ComposerControlScaffolding'

export function ComposerDictationButton({ inputAdapter }: { inputAdapter?: QuickPanelInputAdapter }) {
  const { t } = useTranslation()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherController()
  const launcher = getLaunchers('root-panel').find((item) => item.id === 'dictation')
  const label = launcher?.label ?? t('chat.input.dictation.action.start')
  const snapshot = useSyncExternalStore(dictationService.subscribe, dictationService.getSnapshot)
  const capturing = ['starting', 'recording', 'stopping', 'transcribing'].includes(snapshot.phase)
  const discardLauncher =
    snapshot.phase === 'recorded' || snapshot.retryAvailable || snapshot.recoveryAvailable
      ? launcher?.submenu?.find((item) => item.id === 'dictation:discard')
      : undefined

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
      {capturing && launcher?.suffix ? (
        <span className="text-xs text-muted-foreground tabular-nums">{launcher.suffix}</span>
      ) : null}
      <Tooltip
        content={
          <>
            {label}
            {launcher?.description ? <div role="status">{launcher.description}</div> : null}
          </>
        }>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={`${COMPOSER_SEND_ACCESSORY_BUTTON_CLASS} [&>svg]:!size-4.5`}
          aria-label={typeof label === 'string' ? label : undefined}
          data-active={launcher?.active || undefined}
          disabled={!launcher || launcher.disabled}
          onClick={() => launcher && dispatchLauncher(launcher, { source: 'root-panel', inputAdapter })}>
          {launcher?.icon ?? <Mic />}
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
            onClick={() => dispatchLauncher(discardLauncher, { source: 'root-panel', inputAdapter })}>
            <X className="size-4" />
          </Button>
        </Tooltip>
      )}
    </div>
  )
}
