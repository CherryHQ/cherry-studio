import { Copy, CornerDownLeft, Mic, RotateCcw, Square, Trash2, X } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { dictationService, voiceTargetManager } from '@renderer/services/voice'
import type { DictationErrorCategory, DictationPhase } from '@renderer/services/voice'

const SETTINGS_RECOVERY_ERRORS = new Set<DictationErrorCategory>([
  'model_required',
  'voice_unavailable',
  'unsupported',
  'asset_required',
  'microphone_permission'
])
const PHASE_KEYS: Record<Exclude<DictationPhase, 'idle'>, string> = {
  starting: 'settings.voice.dictation.phase.starting',
  recording: 'settings.voice.dictation.phase.recording',
  stopping: 'settings.voice.dictation.phase.stopping',
  transcribing: 'settings.voice.dictation.phase.transcribing',
  failed: 'settings.voice.dictation.phase.failed',
  recovery: 'settings.voice.dictation.phase.recovery'
}

export function DictationControls({
  targetId,
  disabled,
  focusInput
}: {
  targetId: string
  disabled: boolean
  focusInput: () => void
}) {
  const { t } = useTranslation()
  const snapshot = useSyncExternalStore(dictationService.subscribe, dictationService.getSnapshot)
  const run = (action: () => Promise<unknown>) => {
    void action()
      .catch(() => undefined)
      .finally(focusInput)
  }
  const start = () => {
    if (disabled || voiceTargetManager.captureCurrent()?.targetId !== targetId) return
    void dictationService.startScoped().result.catch(() => undefined)
    focusInput()
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {snapshot.phase !== 'idle' && (
        <span role="status" className="text-xs text-muted-foreground">
          {t(PHASE_KEYS[snapshot.phase])}
          {snapshot.phase === 'recording' &&
            ` ${t('settings.voice.dictation.elapsed', { seconds: Math.floor(snapshot.elapsedMs / 1_000) })}`}
        </span>
      )}
      {snapshot.phase === 'idle' && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('chat.input.dictation.title')}
          disabled={disabled}
          onClick={start}>
          <Mic className="size-4" />
        </Button>
      )}
      {snapshot.phase === 'recording' && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('settings.voice.action.stop_recording')}
          onClick={() => run(() => dictationService.stop())}>
          <Square className="size-4" />
        </Button>
      )}
      {['starting', 'recording', 'stopping', 'transcribing'].includes(snapshot.phase) && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('chat.input.dictation.action.cancel')}
          onClick={() => run(() => dictationService.cancel())}>
          <X className="size-4" />
        </Button>
      )}
      {snapshot.phase === 'failed' && (
        <>
          {snapshot.retryAvailable && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('settings.voice.action.retry')}
              onClick={() => run(() => dictationService.retry())}>
              <RotateCcw className="size-4" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('settings.voice.action.discard')}
            onClick={() => run(() => dictationService.discard())}>
            <Trash2 className="size-4" />
          </Button>
          {snapshot.error && SETTINGS_RECOVERY_ERRORS.has(snapshot.error) && (
            <Button type="button" variant="ghost" size="sm" onClick={() => openSettingsTab('/settings/voice')}>
              {t('settings.voice.action.open_settings')}
            </Button>
          )}
        </>
      )}
      {snapshot.phase === 'recovery' && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('settings.voice.action.insert_recovery')}
            disabled={disabled || voiceTargetManager.captureCurrent()?.targetId !== targetId}
            onClick={() => {
              dictationService.insertRecovery()
              focusInput()
            }}>
            <CornerDownLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('chat.input.dictation.action.copy_recovery')}
            onClick={() => run(() => dictationService.copyRecovery())}>
            <Copy className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('settings.voice.action.discard')}
            onClick={() => run(() => dictationService.discard())}>
            <Trash2 className="size-4" />
          </Button>
        </>
      )}
    </div>
  )
}

export default DictationControls
