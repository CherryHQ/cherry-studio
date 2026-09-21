import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { getTextFromParts } from '@renderer/utils/message/partsHelpers'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { VoiceErrorReason } from '@shared/ipc/errors/voice'

import { speechPlaybackService } from './SpeechPlaybackService'
import { VoiceDomainError } from './VoiceService'

const MAX_COMPLETION_KEYS = 256

type AutoReadPlayback = Pick<typeof speechPlaybackService, 'start' | 'stopAutoRead'>

export interface AutoReadCompletion {
  readonly enabled: boolean
  readonly message: CherryUIMessage
  readonly attemptId: number
  readonly isAbort: boolean
  readonly isError: boolean
  readonly eligible?: boolean
}

export type AutoReadResult =
  | { status: 'started'; key: string }
  | {
      status: 'skipped'
      key: string
      reason: 'duplicate' | 'disabled' | 'ineligible' | 'aborted' | 'error' | 'empty' | 'busy' | 'too_long'
    }
  | { status: 'failed'; key: string; reason: VoiceErrorReason }

interface AutoReadCoordinatorOptions {
  playback?: AutoReadPlayback
  reportError?: (reason: VoiceErrorReason) => void
}

const errorTranslationKeys: Partial<Record<VoiceErrorReason, string>> = {
  model_required: 'settings.voice.status.unconfigured',
  voice_unavailable: 'settings.voice.status.voice_unavailable',
  unsupported: 'settings.voice.status.unsupported',
  asset_required: 'settings.voice.status.asset_required',
  license_unverified: 'settings.voice.status.license_unverified',
  operation_failed: 'settings.voice.status.operation_failed'
}

function reportAutoReadError(reason: VoiceErrorReason): void {
  const key = errorTranslationKeys[reason] ?? 'settings.voice.status.operation_failed'
  toast.error(i18n.t(key))
}

export class AutoReadCoordinator {
  readonly #playback: AutoReadPlayback
  readonly #reportError: (reason: VoiceErrorReason) => void
  readonly #completionKeys = new Set<string>()
  #enabled: boolean | undefined

  constructor(options: AutoReadCoordinatorOptions = {}) {
    this.#playback = options.playback ?? speechPlaybackService
    this.#reportError = options.reportError ?? reportAutoReadError
  }

  async setEnabled(enabled: boolean): Promise<void> {
    const wasEnabled = this.#enabled
    this.#enabled = enabled
    if (wasEnabled === true && !enabled) {
      try {
        await this.#playback.stopAutoRead()
      } catch {
        this.#reportError('operation_failed')
      }
    }
  }

  async consume(input: AutoReadCompletion): Promise<AutoReadResult> {
    const key = `auto-read:${input.message.id}:${input.attemptId}`
    if (this.#completionKeys.has(key)) return { status: 'skipped', key, reason: 'duplicate' }
    this.#claim(key)

    if (!input.enabled) return { status: 'skipped', key, reason: 'disabled' }
    if (input.eligible === false || input.message.role !== 'assistant') {
      return { status: 'skipped', key, reason: 'ineligible' }
    }
    if (input.isAbort) return { status: 'skipped', key, reason: 'aborted' }
    if (input.isError) return { status: 'skipped', key, reason: 'error' }

    const text = getTextFromParts(input.message.parts ?? [])
    if (!text.trim()) return { status: 'skipped', key, reason: 'empty' }

    try {
      const result = await this.#playback.start({
        text,
        trigger: 'auto_read',
        mode: 'document',
        confirmed: false,
        sourceLabel: 'message',
        sourceEntityId: input.message.id
      })
      if (result.status === 'started') return { status: 'started', key }
      return { status: 'skipped', key, reason: 'too_long' }
    } catch (error) {
      const reason = error instanceof VoiceDomainError ? error.reason : 'operation_failed'
      if (reason === 'busy' || reason === 'aborted') return { status: 'skipped', key, reason }
      this.#reportError(reason)
      return { status: 'failed', key, reason }
    }
  }

  #claim(key: string): void {
    this.#completionKeys.add(key)
    if (this.#completionKeys.size <= MAX_COMPLETION_KEYS) return
    const oldest = this.#completionKeys.values().next().value
    if (oldest) this.#completionKeys.delete(oldest)
  }
}

export const autoReadCoordinator = new AutoReadCoordinator()
