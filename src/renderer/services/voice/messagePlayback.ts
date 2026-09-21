import i18n from '@renderer/i18n/resolver'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { getTextFromParts } from '@renderer/utils/message/partsHelpers'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { VoiceErrorReason } from '@shared/ipc/errors/voice'

import { speechPlaybackService } from './SpeechPlaybackService'
import { VoiceDomainError } from './VoiceService'

export interface ReadMessageAloudInput {
  readonly messageId: string
  readonly parts: readonly CherryMessagePart[]
  readonly focusOnClose?: () => void
}

const settingsRecoveryReasons: ReadonlySet<VoiceErrorReason> = new Set([
  'model_required',
  'voice_unavailable',
  'unsupported',
  'asset_required',
  'license_unverified'
])

function playbackErrorKey(reason: VoiceErrorReason) {
  switch (reason) {
    case 'voice_unavailable':
    case 'unsupported':
    case 'asset_required':
    case 'license_unverified':
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

export async function readMessageAloud({ messageId, parts, focusOnClose }: ReadMessageAloudInput): Promise<void> {
  const text = getTextFromParts([...parts])
  if (!text.trim()) return

  const startInput = {
    text,
    trigger: 'manual' as const,
    mode: 'document' as const,
    confirmed: false,
    sourceLabel: 'message' as const,
    sourceEntityId: messageId
  }

  try {
    const result = await speechPlaybackService.start(startInput)
    if (result.status !== 'confirmation_required') return

    const confirmed = await popup.confirm({
      title: i18n.t('settings.voice.playback.long_text.title'),
      content: i18n.t('settings.voice.playback.long_text.description', { count: result.normalizedLength }),
      okText: i18n.t('common.confirm'),
      cancelText: i18n.t('common.cancel'),
      focusOnClose
    })
    if (!confirmed) return

    await speechPlaybackService.start({ ...startInput, confirmed: true })
  } catch (error) {
    showPlaybackError(error)
  }
}
