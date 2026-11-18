import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { getTextFromParts } from '@renderer/utils/message/partsHelpers'
import { SpeechInputKind, SpeechOutputKind } from '@shared/ai/voice'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { VoiceErrorReason } from '@shared/ipc/errors/voice'

import { IncrementalReadableText } from './incrementalReadableText'
import { normalizeReadableText } from './readableText'
import { speechPlaybackService } from './SpeechPlaybackService'
import { SpeechTextInput } from './SpeechTextInput'
import { VoiceDomainError, voiceService } from './VoiceService'

const MAX_COMPLETION_KEYS = 256
type AutoReadFailure = VoiceErrorReason | 'text_limit'

type AutoReadPlayback = Pick<typeof speechPlaybackService, 'start' | 'stopAutoRead'>

export interface AutoReadCompletion {
  readonly enabled: boolean
  readonly message: CherryUIMessage
  readonly attemptId: number
  readonly isAbort: boolean
  readonly isError: boolean
  readonly eligible?: boolean
  readonly scope?: string
}

export type AutoReadResult =
  | { status: 'started'; key: string }
  | {
      status: 'skipped'
      key: string
      reason: 'duplicate' | 'disabled' | 'ineligible' | 'aborted' | 'error' | 'empty' | 'busy' | 'too_long'
    }
  | { status: 'failed'; key: string; reason: VoiceErrorReason }

interface AutoReadServiceOptions {
  supportsStreaming?: () => Promise<boolean>
  playback?: AutoReadPlayback
  reportError?: (reason: AutoReadFailure) => void
}

const errorTranslationKeys: Partial<Record<AutoReadFailure, string>> = {
  text_limit: 'settings.voice.auto_read.text_limit',
  model_required: 'settings.voice.status.unconfigured',
  voice_unavailable: 'settings.voice.status.voice_unavailable',
  unsupported: 'settings.voice.status.unsupported',
  asset_required: 'settings.voice.status.asset_required',
  operation_failed: 'settings.voice.status.operation_failed'
}

function reportAutoReadError(reason: AutoReadFailure): void {
  const key = errorTranslationKeys[reason] ?? 'settings.voice.status.operation_failed'
  toast.error(i18n.t(key))
}

interface StreamingRead {
  readonly key: string
  readonly scope?: string
  readonly messageId: string
  readonly controller: AbortController
  readonly parser: IncrementalReadableText
  readonly input: SpeechTextInput
  text: string
  final: boolean
  fallback: boolean
  checked: boolean
  started: boolean
  version: number
  outcome?: AutoReadResult
  draining?: Promise<void>
}

async function supportsTextStreaming(): Promise<boolean> {
  const [preferences, catalog] = await Promise.all([
    voiceService.readSpeechPreferenceInput(),
    voiceService.listModels()
  ])
  const model = catalog.models.find((model) => model.id === (preferences.modelId ?? catalog.defaultSpeechModelId))
  return (
    model?.voiceCapabilities.speech?.some(
      (operation) => operation.input === SpeechInputKind.TextStream && operation.output === SpeechOutputKind.PcmStream
    ) ?? false
  )
}

export class AutoReadService {
  readonly #playback: AutoReadPlayback
  readonly #reportError: (reason: AutoReadFailure) => void
  readonly #completionKeys = new Set<string>()
  #enabled: boolean | undefined
  readonly #streams = new Map<string, StreamingRead>()
  readonly #supportsStreaming: () => Promise<boolean>

  constructor(options: AutoReadServiceOptions = {}) {
    this.#supportsStreaming = options.supportsStreaming ?? supportsTextStreaming
    this.#playback = options.playback ?? speechPlaybackService
    this.#reportError = options.reportError ?? reportAutoReadError
  }

  async setEnabled(enabled: boolean): Promise<void> {
    const wasEnabled = this.#enabled
    this.#enabled = enabled
    if (wasEnabled === true && !enabled) {
      for (const record of this.#streams.values()) this.#cancel(record)
      try {
        await this.#playback.stopAutoRead()
      } catch {
        this.#reportError('operation_failed')
      }
    }
  }

  update(input: Omit<AutoReadCompletion, 'isAbort' | 'isError'>): void {
    const key = `auto-read:${input.message.id}:${input.attemptId}`
    if (this.#completionKeys.has(key)) return
    if (!input.enabled || this.#enabled === false || input.eligible === false || input.message.role !== 'assistant') {
      const record = this.#streams.get(key)
      if (record) this.#cancel(record)
      if (!input.enabled || this.#enabled === false || record) this.#claim(key)
      return
    }
    let record = this.#streams.get(key)
    if (!record) {
      if (this.#streams.size >= 8) {
        this.#claim(key)
        return
      }
      record = {
        key,
        scope: input.scope,
        messageId: input.message.id,
        controller: new AbortController(),
        parser: new IncrementalReadableText(),
        input: new SpeechTextInput(),
        text: '',
        final: false,
        fallback: false,
        checked: false,
        started: false,
        version: 0
      }
      this.#streams.set(key, record)
      const owned = record
      void owned.input.closed.then(() => {
        if (this.#streams.get(key) === owned) {
          this.#claim(key)
          this.#streams.delete(key)
        }
      })
    }
    if (record.final || record.fallback) return
    record.text = getTextFromParts(input.message.parts ?? [])
    if (record.text.length > 20_000) {
      this.#cancel(record)
      this.#reportError('text_limit')
      return
    }
    record.version++
    this.#drain(record)
  }

  cancelScope(scope: string): void {
    for (const record of this.#streams.values()) if (record.scope === scope) this.#cancel(record)
  }

  #cancel(record: StreamingRead): void {
    this.#claim(record.key)
    this.#streams.delete(record.key)
    record.controller.abort()
    record.input.cancel()
  }

  #drain(record: StreamingRead): void {
    if (record.draining || record.fallback) return
    record.draining = (async () => {
      if (!record.checked) {
        record.fallback = !(await this.#supportsStreaming())
        record.checked = true
        if (record.fallback) return
      }
      while (!record.controller.signal.aborted) {
        const version = record.version
        const text = record.parser.update(record.text, record.final)
        if (text && !record.started) {
          record.started = true
          const result = await this.#playback.start({
            text,
            textInput: record.input,
            signal: record.controller.signal,
            trigger: 'auto_read',
            mode: 'selection',
            sourceLabel: 'message',
            sourceEntityId: record.messageId
          })
          if (result.status !== 'started') {
            record.outcome = { status: 'skipped', key: record.key, reason: 'too_long' }
            this.#cancel(record)
            return
          }
        } else if (text) record.input.push(text)
        if (version !== record.version) continue
        if (record.final) {
          this.#claim(record.key)
          if (record.started) record.input.finish()
          else this.#cancel(record)
        }
        return
      }
    })()
      .catch((error: unknown) => {
        this.#cancel(record)
        const reason =
          error instanceof RangeError
            ? 'text_limit'
            : error instanceof VoiceDomainError
              ? error.reason
              : 'operation_failed'
        record.outcome =
          reason === 'text_limit' || reason === 'aborted' || reason === 'busy'
            ? { status: 'skipped', key: record.key, reason: reason === 'text_limit' ? 'too_long' : reason }
            : { status: 'failed', key: record.key, reason }
        if (reason !== 'aborted' && reason !== 'busy') this.#reportError(reason)
      })
      .finally(() => {
        record.draining = undefined
      })
  }

  async consume(input: AutoReadCompletion): Promise<AutoReadResult> {
    const key = `auto-read:${input.message.id}:${input.attemptId}`
    const record = this.#streams.get(key)
    if (record && !record.final) {
      if (input.isAbort || input.isError || !input.enabled || input.eligible === false) {
        this.#cancel(record)
        return { status: 'skipped', key, reason: input.isAbort ? 'aborted' : input.isError ? 'error' : 'disabled' }
      }
      record.text = getTextFromParts(input.message.parts ?? [])
      record.final = true
      record.version++
      if (record.draining) await record.draining
      if (!record.fallback && !record.controller.signal.aborted) {
        this.#drain(record)
        await record.draining
      }
      if (record.outcome) return record.outcome
      if (record.controller.signal.aborted) return { status: 'skipped', key, reason: 'aborted' }
      if (!record.fallback)
        return record.started ? { status: 'started', key } : { status: 'skipped', key, reason: 'empty' }
      this.#streams.delete(key)
      record.input.cancel()
    }
    if (this.#completionKeys.has(key)) return { status: 'skipped', key, reason: 'duplicate' }
    this.#claim(key)

    if (!input.enabled || this.#enabled === false) return { status: 'skipped', key, reason: 'disabled' }
    if (input.eligible === false || input.message.role !== 'assistant') {
      return { status: 'skipped', key, reason: 'ineligible' }
    }
    if (input.isAbort) return { status: 'skipped', key, reason: 'aborted' }
    if (input.isError) return { status: 'skipped', key, reason: 'error' }

    const text = getTextFromParts(input.message.parts ?? [])
    try {
      if (!normalizeReadableText(text)) return { status: 'skipped', key, reason: 'empty' }

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

export const autoReadService = new AutoReadService()
