import { application } from '@application'
import { loggerService } from '@logger'
import { getAppLanguage } from '@main/i18n'
import { isTranscriptionModelId, TranscriptionLanguageSource } from '@shared/ai/localVoice'
import { TranscriptionInputKind, TranscriptionOutputKind } from '@shared/ai/voice'

import { startTranscription } from './execution'
import type { TranscriptionExecution } from './executionTypes'
import { getLocalVoiceStatus, resolveTranscriptionRequest, voiceAudioProcess } from './localAdapters'
import { inspectCanonicalWav } from './localAdapters/inspectCanonicalWav'
import type { VoiceAudioInput } from './localAdapters/voiceAudioProcess'
import { VoiceRuntimeError } from './VoiceRuntimeError'

const logger = loggerService.withContext('channelTranscription')

export async function transcribeChannelAudio(input: VoiceAudioInput, callerSignal?: AbortSignal): Promise<string> {
  const deadline = Date.now() + 60_000
  const controller = new AbortController()
  const { signal } = controller
  const pending: Promise<unknown>[] = []
  const cleanup: Promise<unknown>[] = []
  let text = ''
  let failure: unknown
  let execution: TranscriptionExecution | undefined
  let disposeDecoder: (() => void) | undefined
  let cancelExecution: (() => void) | undefined
  let decodeTimer: ReturnType<typeof setTimeout> | undefined
  const observe = <T>(promise: Promise<T>): Promise<T> => {
    void promise.catch(() => {})
    pending.push(promise)
    return promise
  }
  const clean = (operation: () => Promise<void>) => {
    try {
      cleanup.push(observe(operation()))
    } catch (error) {
      cleanup.push(observe(Promise.reject(error)))
    }
  }
  const abort = () => {
    controller.abort(new VoiceRuntimeError('aborted'))
    cancelExecution?.()
    disposeDecoder?.()
  }
  const check = () => {
    if (Date.now() >= deadline) abort()
    signal.throwIfAborted()
  }
  let interrupt: () => void = () => {}
  const interrupted = new Promise<never>((_resolve, reject) => {
    interrupt = () => reject(signal.reason)
    signal.addEventListener('abort', interrupt, { once: true })
  })
  void interrupted.catch(() => {})
  // 60s 是工作结果截止并发起取消的时间；返回与资源释放需等待底层清理，可能超过 60s。
  const timer = setTimeout(abort, Math.max(0, deadline - Date.now()))
  callerSignal?.addEventListener('abort', abort, { once: true })
  const wait = async <T>(promise: Promise<T>): Promise<T> => {
    const value = await Promise.race([observe(promise), interrupted])
    check()
    return value
  }
  try {
    if (callerSignal?.aborted) abort()
    check()
    const preferences = application.get('PreferenceService').getMultiple({
      modelId: 'feature.voice.recognition.model_id',
      language: 'feature.voice.recognition.language'
    })
    const modelId = preferences.modelId ?? ''
    const locale = (preferences.language ?? '').trim()
    if (!modelId || !isTranscriptionModelId(modelId)) throw new VoiceRuntimeError('unsupported')
    const plan = resolveTranscriptionRequest({
      modelId,
      language:
        locale && locale.toLowerCase() !== 'auto'
          ? { source: TranscriptionLanguageSource.Explicit, locale }
          : { source: TranscriptionLanguageSource.Interface, locale: Intl.getCanonicalLocales(getAppLanguage())[0] }
    })
    check()
    const status = await wait(getLocalVoiceStatus(plan.modelId, plan.options, signal))
    if (status.status !== 'ready') throw new VoiceRuntimeError('unsupported')
    check()
    decodeTimer = setTimeout(abort, Math.min(30_000, Math.max(0, deadline - Date.now())))
    const decoder = application.get('UtilityProcessManager').createInstance(voiceAudioProcess)
    let disposed = false
    disposeDecoder = () => {
      if (disposed) return
      disposed = true
      clean(() => decoder.dispose())
    }
    const { wav } = await wait(
      decoder.request(
        'decode',
        {
          audio: input.audio,
          mimeType: input.mimeType.split(';')[0].trim().toLowerCase()
        },
        { signal }
      )
    )
    clearTimeout(decodeTimer)
    disposeDecoder()
    disposeDecoder = undefined
    inspectCanonicalWav(wav)
    check()
    execution = startTranscription(
      {
        modelId: plan.modelId,
        input: { kind: TranscriptionInputKind.Audio, audio: wav },
        output: TranscriptionOutputKind.Final,
        options: plan.options
      },
      signal
    )
    void observe(execution.completed)
    void observe(execution.closed)
    if (execution.ready) void observe(execution.ready)
    let cancelled = false
    cancelExecution = () => {
      if (cancelled) return
      cancelled = true
      clean(() => execution!.cancel())
    }
    check()
    const result = await wait(execution.completed)
    text = result.text.trim()
    if (!text) throw new VoiceRuntimeError('operation_failed')
    await wait(execution.closed)
  } catch (error) {
    abort()
    failure = error
  } finally {
    clearTimeout(decodeTimer)
    disposeDecoder?.()
    const results = await Promise.allSettled([...pending, ...cleanup])
    if (Date.now() >= deadline) abort()
    const failedCleanup = await Promise.allSettled([...cleanup, ...(execution ? [execution.closed] : [])])
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', abort)
    signal.removeEventListener('abort', interrupt)
    if (failedCleanup.some((result) => result.status === 'rejected')) {
      logger.warn('Channel transcription cleanup failed', { operations: results.length })
      failure = new VoiceRuntimeError('operation_failed')
    }
  }
  if (failure) throw failure
  signal.throwIfAborted()
  return text
}
