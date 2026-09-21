import { Copy, CornerDownLeft, LoaderCircle, Mic, RotateCcw, Square, Trash2, X } from 'lucide-react'
import React, { useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { useTimer } from '@renderer/hooks/useTimer'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { dictationService, voiceTargetManager } from '@renderer/services/voice'
import type { DictationErrorCategory, DictationPhase } from '@renderer/services/voice'
import type { Model } from '@shared/data/types/model'

const errorTranslationKeys: Partial<Record<DictationErrorCategory, string>> = {
  model_required: 'settings.voice.status.unconfigured',
  voice_unavailable: 'settings.voice.status.voice_unavailable',
  unsupported: 'settings.voice.status.unsupported',
  asset_required: 'settings.voice.status.asset_required',
  license_unverified: 'settings.voice.status.license_unverified',
  microphone_permission: 'settings.voice.microphone.denied',
  operation_failed: 'settings.voice.status.operation_failed',
  recording_failed: 'settings.voice.status.operation_failed',
  transcription_failed: 'settings.voice.status.operation_failed',
  clipboard_failed: 'settings.voice.status.operation_failed'
}

const settingsRecoveryErrors = new Set<DictationErrorCategory>([
  'model_required',
  'voice_unavailable',
  'unsupported',
  'asset_required',
  'license_unverified',
  'microphone_permission'
])

const phaseTranslationKeys: Record<Exclude<DictationPhase, 'idle'>, string> = {
  starting: 'settings.voice.dictation.phase.starting',
  recording: 'settings.voice.dictation.phase.recording',
  stopping: 'settings.voice.dictation.phase.stopping',
  transcribing: 'settings.voice.dictation.phase.transcribing',
  failed: 'settings.voice.dictation.phase.failed',
  recovery: 'settings.voice.dictation.phase.recovery'
}

interface InputBarProps {
  text: string
  model?: Model
  placeholder: string
  loading: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
  dictationTargetId?: string
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

const InputBar = ({
  ref,
  text,
  model,
  placeholder,
  loading,
  inputRef,
  dictationTargetId,
  handleKeyDown,
  handleChange
}: InputBarProps & { ref?: React.RefObject<HTMLDivElement | null> }) => {
  const localInputRef = useRef<HTMLInputElement>(null)
  const resolvedInputRef = inputRef ?? localInputRef
  const { t } = useTranslation()
  const { setTimeoutTimer } = useTimer()
  const dictation = useSyncExternalStore(dictationService.subscribe, dictationService.getSnapshot)
  if (!loading) {
    setTimeoutTimer('focus', () => resolvedInputRef.current?.focus(), 0)
  }

  const startDictation = () => {
    if (!dictationTargetId || !voiceTargetManager.markCurrent(dictationTargetId)) return
    void dictationService.startScoped().result
  }

  const markDictationTarget = () => {
    if (dictationTargetId) voiceTargetManager.markCurrent(dictationTargetId)
  }

  const dictationStatus =
    dictation.phase === 'recording'
      ? `${t('settings.voice.dictation.phase.recording')} ${t('settings.voice.dictation.elapsed', {
          seconds: Math.floor(dictation.elapsedMs / 1_000)
        })}`
      : dictation.phase === 'idle'
        ? undefined
        : t(phaseTranslationKeys[dictation.phase])
  const dictationError = dictation.error
    ? t(errorTranslationKeys[dictation.error] ?? 'settings.voice.status.failed')
    : ''

  return (
    <div ref={ref} className="mt-2.5 flex items-center gap-2">
      {model && <ModelAvatar model={model} size={30} />}
      <Input
        ref={resolvedInputRef}
        value={text}
        placeholder={placeholder}
        autoFocus
        onFocus={markDictationTarget}
        onPointerDown={markDictationTarget}
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        className="h-auto rounded-none border-0 bg-transparent px-0 py-0 text-lg shadow-none [-webkit-app-region:no-drag] placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
      />
      {dictationStatus && (
        <span role="status" className="text-xs text-muted-foreground">
          {dictationStatus}
          {dictationError && `: ${dictationError}`}
        </span>
      )}
      {dictation.phase === 'idle' && dictationTargetId && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('chat.input.dictation.title')}
          disabled={loading}
          onClick={startDictation}>
          <Mic className="size-4" />
        </Button>
      )}
      {dictation.phase === 'recording' && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('settings.voice.action.stop_recording')}
            onClick={() => void dictationService.stop()}>
            <Square className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('chat.input.dictation.action.cancel')}
            onClick={() => void dictationService.cancel()}>
            <X className="size-4" />
          </Button>
        </>
      )}
      {['starting', 'stopping', 'transcribing'].includes(dictation.phase) && (
        <>
          <LoaderCircle aria-hidden className="size-4 animate-spin text-muted-foreground" />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('chat.input.dictation.action.cancel')}
            onClick={() => void dictationService.cancel()}>
            <X className="size-4" />
          </Button>
        </>
      )}
      {dictation.phase === 'failed' && (
        <>
          {dictation.retryAvailable && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('settings.voice.action.retry')}
              onClick={() => void dictationService.retry()}>
              <RotateCcw className="size-4" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('settings.voice.action.discard')}
            onClick={() => void dictationService.discard()}>
            <Trash2 className="size-4" />
          </Button>
          {dictation.error && settingsRecoveryErrors.has(dictation.error) && (
            <Button type="button" variant="ghost" size="sm" onClick={() => openSettingsTab('/settings/voice')}>
              {t('settings.voice.action.open_settings')}
            </Button>
          )}
        </>
      )}
      {dictation.phase === 'recovery' && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('settings.voice.action.insert_recovery')}
            onClick={() => dictationService.insertRecovery()}>
            <CornerDownLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('chat.input.dictation.action.copy_recovery')}
            onClick={() => void dictationService.copyRecovery()}>
            <Copy className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('settings.voice.action.discard')}
            onClick={() => void dictationService.discard()}>
            <Trash2 className="size-4" />
          </Button>
        </>
      )}
    </div>
  )
}
InputBar.displayName = 'InputBar'

export default InputBar
