import i18n from '@renderer/i18n/resolver'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { VoiceErrorReason } from '@shared/ipc/errors/voice'

import type { ReadableTextMode } from './readableText'
import { speechPlaybackService, type SpeechPlaybackSourceLabel } from './SpeechPlaybackService'
import { VoiceDomainError } from './VoiceService'

export interface ReadTextAloudInput {
  readonly text: string
  readonly mode: ReadableTextMode
  readonly sourceLabel: SpeechPlaybackSourceLabel
  readonly sourceEntityId: string
  readonly focusOnClose?: () => void
  readonly isCurrent?: () => boolean
}

const settingsRecoveryReasons: ReadonlySet<VoiceErrorReason> = new Set([
  'model_required',
  'voice_unavailable',
  'unsupported',
  'asset_required'
])

function playbackErrorKey(reason: VoiceErrorReason) {
  switch (reason) {
    case 'voice_unavailable':
    case 'unsupported':
    case 'asset_required':
      return `settings.voice.status.${reason}` as const
    case 'model_required':
      return 'settings.voice.status.unconfigured' as const
    case 'busy':
    case 'aborted':
      return `settings.voice.playback.error.${reason}` as const
    default:
      return 'settings.voice.status.operation_failed' as const
  }
}

function showPlaybackError(error: unknown): void {
  const reason = error instanceof VoiceDomainError ? error.reason : 'operation_failed'
  const title = i18n.t(playbackErrorKey(reason))

  if (!settingsRecoveryReasons.has(reason)) {
    toast.error({ title })
    return
  }

  toast.error({
    title,
    action: {
      label: i18n.t('settings.voice.action.open_settings'),
      onClick: () => openSettingsTab('/settings/voice')
    }
  })
}

export async function readTextAloud({
  text,
  mode,
  sourceLabel,
  sourceEntityId,
  focusOnClose,
  isCurrent
}: ReadTextAloudInput): Promise<void> {
  if (!text.trim() || isCurrent?.() === false) return

  const startInput = {
    text,
    trigger: 'manual' as const,
    mode,
    confirmed: false,
    sourceLabel,
    sourceEntityId
  }

  try {
    const result = await speechPlaybackService.start(startInput)
    if (result.status !== 'confirmation_required' || isCurrent?.() === false) return

    const confirmed = await popup.confirm({
      title: i18n.t('settings.voice.playback.long_text.title'),
      content: i18n.t('settings.voice.playback.long_text.description', { count: result.normalizedLength }),
      okText: i18n.t('common.confirm'),
      cancelText: i18n.t('common.cancel'),
      focusOnClose
    })
    if (!confirmed || isCurrent?.() === false) return

    await speechPlaybackService.start({ ...startInput, confirmed: true })
  } catch (error) {
    if (isCurrent?.() !== false) showPlaybackError(error)
  } finally {
    if (isCurrent?.() !== false) focusOnClose?.()
  }
}
