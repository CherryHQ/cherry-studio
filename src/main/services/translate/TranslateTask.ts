/**
 * One translation, from its first async step to the run's end.
 *
 * A translation is not one call but a chain: detect the source language, decide the target from
 * it, then stream. Keeping that chain in the renderer meant a window detach destroyed it —
 * detach rebuilds the renderer, taking with it not just the in-flight promise but which step the
 * flow was on. Main is the only process that outlives that, so the chain lives here.
 *
 * The task is the stream's listener rather than the window being one: it accumulates the text
 * itself and forwards to whichever window is attached, so re-attaching after a detach is a matter
 * of swapping the forwarder and replaying what was missed.
 */

import { application } from '@application'
import { loggerService } from '@logger'
import { translateLanguageService } from '@main/data/services/TranslateLanguageService'
import type { TranslateBidirectionalPair, TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { UniqueModelId } from '@shared/data/types/model'
import type { WindowId } from '@shared/ipc/types'
import { determineTargetLanguage, UNKNOWN_LANG_CODE } from '@shared/utils/translateLanguage'
import type { UIMessageChunk } from 'ai'

import {
  type StreamDoneResult,
  type StreamErrorResult,
  type StreamListener,
  type StreamPausedResult,
  WebContentsListener
} from '../../ai/streamManager'
import { detectLanguageOrUnknown } from './detectLanguage'

const logger = loggerService.withContext('translate/task')

export interface TranslateTaskRequest {
  /** Text to translate. */
  text: string
  /** The user's configured source language; `'auto'` asks for detection. */
  sourceLangCode: TranslateLangCode | 'auto'
  /** The user's configured target language. */
  targetLangCode: TranslateLangCode
  /** Whether the bidirectional pair may override the target once the source is known. */
  bidirectional: boolean
  /** The configured pair, required when `bidirectional`. */
  bidirectionalPair: TranslateBidirectionalPair
}

/** What a renderer needs to render the task, and can rebuild from after re-attaching. */
export interface TranslateTaskState {
  taskId: string
  streamId: string
  busy: boolean
  accumulated: string
  detectedSourceLanguage: TranslateLangCode | null
}

interface TaskHost {
  /** Drop the task from the registry; called once, on whichever terminal path runs first. */
  finish: (taskId: string) => void
}

export class TranslateTask implements StreamListener {
  readonly id: string
  private forwarder: WebContentsListener | undefined
  private senderId: WindowId
  private accumulated = ''
  private detectedSourceLanguage: TranslateLangCode | null = null
  private settled = false
  private cancelled = false
  private streamOpened = false
  /** Ends the detection step; the stream has its own abort path through `AiStreamManager`. */
  private readonly detection = new AbortController()
  private unwatchWindow: (() => void) | undefined

  constructor(
    readonly taskId: string,
    readonly streamId: string,
    private readonly request: TranslateTaskRequest,
    senderId: WindowId,
    sender: Electron.WebContents,
    private readonly host: TaskHost
  ) {
    this.id = `translate-task:${taskId}`
    this.senderId = senderId
    this.forwarder = new WebContentsListener(sender, streamId)
    this.watchWindow(sender)
  }

  /**
   * A window that dies without cancelling leaves nothing on the renderer side to notice: the
   * sweep that would have released the tab session is itself a renderer effect, and a destroyed
   * window never runs one. So the task watches for that here.
   */
  private watchWindow(sender: Electron.WebContents): void {
    const onDestroyed = () => {
      if (this.settled) return
      logger.info('translate task cancelled by window destruction', { taskId: this.taskId })
      this.cancel()
    }
    sender.once('destroyed', onDestroyed)
    this.unwatchWindow = () => sender.removeListener('destroyed', onDestroyed)
  }

  get state(): TranslateTaskState {
    return {
      taskId: this.taskId,
      streamId: this.streamId,
      busy: !this.settled,
      accumulated: this.accumulated,
      detectedSourceLanguage: this.detectedSourceLanguage
    }
  }

  /** Point the task at another window — the same tab after a detach. */
  attach(senderId: WindowId, sender: Electron.WebContents): TranslateTaskState {
    this.unwatchWindow?.()
    this.senderId = senderId
    this.forwarder = new WebContentsListener(sender, this.streamId)
    this.watchWindow(sender)
    return this.state
  }

  /**
   * Run the chain. Resolves when the task has settled one way or another; the caller does not
   * await it — the renderer follows through events.
   */
  async run(): Promise<void> {
    try {
      const sourceLangCode = await this.resolveSourceLanguage()
      if (this.cancelled) return

      const target = determineTargetLanguage(
        sourceLangCode,
        this.request.targetLangCode,
        this.request.bidirectional && sourceLangCode !== UNKNOWN_LANG_CODE,
        this.request.bidirectionalPair
      )
      if (!target.success) {
        this.fail(target.errorType === 'same_language' ? 'translate.language.same' : 'translate.language.not_pair')
        return
      }

      this.openStream(target.language)
    } catch (error) {
      logger.error('Translate task failed before streaming', error as Error)
      this.fail(error instanceof Error ? error.message : 'translate.error.failed')
    }
  }

  /** End the whole chain — the detection step as well as the stream. */
  cancel(): void {
    if (this.settled) return
    this.cancelled = true
    this.detection.abort()
    if (this.streamOpened) {
      application.get('AiStreamManager').abort(this.streamId, 'translate task cancelled')
    }
    this.settle()
    this.emit('translate.task.aborted', { taskId: this.taskId })
  }

  // ── StreamListener ────────────────────────────────────────────────

  onChunk(chunk: UIMessageChunk, sourceModelId?: UniqueModelId, anchorMessageId?: string, attemptId?: number): void {
    if (isTextDelta(chunk)) this.accumulated += chunk.delta
    this.forwarder?.onChunk(chunk, sourceModelId, anchorMessageId, attemptId)
  }

  onDone(result: StreamDoneResult): void {
    void this.forwarder?.onDone(result)
    if (this.settled) return
    const text = this.accumulated.trim()
    this.settle()
    if (!text) {
      this.emit('translate.task.failed', { taskId: this.taskId, messageKey: 'translate.error.empty' })
      return
    }
    this.emit('translate.task.completed', {
      taskId: this.taskId,
      text,
      sourceLangCode: this.detectedSourceLanguage ?? undefined
    })
  }

  onPaused(result: StreamPausedResult): void {
    void this.forwarder?.onPaused(result)
  }

  onError(result: StreamErrorResult): void {
    void this.forwarder?.onError(result)
    if (this.settled) return
    this.settle()
    this.emit('translate.task.failed', { taskId: this.taskId, messageKey: result.error.message })
  }

  isAlive(): boolean {
    return !this.settled
  }

  // ── internals ─────────────────────────────────────────────────────

  private async resolveSourceLanguage(): Promise<TranslateLangCode> {
    const needsDetection = this.request.bidirectional || this.request.sourceLangCode === 'auto'
    if (!needsDetection) return this.request.sourceLangCode

    // Detection failing is not the task failing: the flow continues with UNKNOWN, which the
    // target resolution treats as "no bidirectional override".
    const detected = await detectLanguageOrUnknown(this.request.text, this.detection.signal)
    this.detectedSourceLanguage = detected
    this.emitState()
    return detected
  }

  private openStream(targetLangCode: TranslateLangCode): void {
    const targetLanguage = translateLanguageService.getByLangCode(targetLangCode)
    const translateService = application.get('TranslateService')
    const { uniqueModelId, content, model } = translateService.resolveTranslatePayload(
      this.request.text,
      targetLanguage
    )
    const { reasoningEffort, callOverrides } = translateService.resolveRequestParameters(model)

    this.streamOpened = true
    application.get('AiStreamManager').streamPrompt({
      streamId: this.streamId,
      uniqueModelId,
      prompt: content,
      listener: this,
      reasoningEffort,
      callOverrides
    })
    logger.info('translate task stream opened', { taskId: this.taskId, streamId: this.streamId, uniqueModelId })
  }

  private fail(messageKey: string): void {
    if (this.settled) return
    this.settle()
    this.emit('translate.task.failed', { taskId: this.taskId, messageKey })
  }

  private settle(): void {
    this.settled = true
    this.unwatchWindow?.()
    this.unwatchWindow = undefined
    this.host.finish(this.taskId)
  }

  private emitState(): void {
    this.emit('translate.task.state', this.state)
  }

  private emit(
    event: 'translate.task.state' | 'translate.task.completed' | 'translate.task.aborted' | 'translate.task.failed',
    payload: unknown
  ): void {
    application.get('IpcApiService').send(this.senderId, event as never, payload as never)
  }
}

function isTextDelta(chunk: UIMessageChunk): chunk is UIMessageChunk & { delta: string } {
  return (chunk as { type?: string }).type === 'text-delta' && typeof (chunk as { delta?: unknown }).delta === 'string'
}
