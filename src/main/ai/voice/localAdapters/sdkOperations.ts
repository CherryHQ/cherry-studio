import type { SpeechModelV3, TranscriptionModelV3 } from '@ai-sdk/provider'
import { NoTranscriptGeneratedError } from 'ai'

import { generateSpeech, transcribe, type SpeechOptions, type TranscriptionOptions } from '@cherrystudio/ai-core'
import { SpeechInputKind, SpeechOutputKind, TranscriptionInputKind, TranscriptionOutputKind } from '@shared/ai/voice'

import type { SpeechOperation, TranscriptRevision, TranscriptionOperation } from '../executionTypes'
import { VoiceCleanupError, VoiceRuntimeError } from '../VoiceRuntimeError'

function completeExecution<T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) {
  const controller = new AbortController()
  const executionSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  let settled = false
  const completed = Promise.resolve()
    .then(async () => {
      executionSignal.throwIfAborted()
      const result = await work(executionSignal)
      executionSignal.throwIfAborted()
      return result
    })
    .finally(() => {
      settled = true
    })
  const closed = completed.then(
    () => undefined,
    (error: unknown) => {
      if (error instanceof VoiceCleanupError) throw error
    }
  )
  // Observe failures even when callers cancel before consuming any output.
  void closed.catch(() => undefined)
  return {
    completed,
    closed,
    cancel: () => {
      if (!settled) controller.abort(new VoiceRuntimeError('aborted'))
      return closed
    }
  }
}

export function completeSpeechOperation(
  createModel: (options: SpeechOptions) => SpeechModelV3
): Extract<SpeechOperation, { input: typeof SpeechInputKind.Text; output: typeof SpeechOutputKind.Audio }> {
  return {
    input: SpeechInputKind.Text,
    output: SpeechOutputKind.Audio,
    start: (input, options, signal) => {
      const frozenOptions = { ...options }
      const text = input.text
      const task = completeExecution(async (executionSignal) => {
        const result = await generateSpeech(createModel(frozenOptions), text, frozenOptions, executionSignal)
        return { kind: SpeechOutputKind.Audio, ...result }
      }, signal)
      const completed = task.completed.then(() => undefined)
      void completed.catch(() => undefined)
      return { ...task, output: task.completed, completed }
    }
  }
}

export function completeTranscriptionOperation(
  createModel: (options: TranscriptionOptions) => TranscriptionModelV3
): Extract<TranscriptionOperation, { input: typeof TranscriptionInputKind.Audio }> {
  return {
    input: TranscriptionInputKind.Audio,
    output: TranscriptionOutputKind.Final,
    start: (input, options, signal) => {
      const frozenOptions = { ...options }
      const audio = Uint8Array.from(input.audio)
      const task = completeExecution(async (executionSignal) => {
        try {
          const result = await transcribe(createModel(frozenOptions), audio, frozenOptions, executionSignal)
          if (!result.text.trim()) throw new VoiceRuntimeError('no_speech')
          return result
        } catch (error) {
          if (NoTranscriptGeneratedError.isInstance(error)) {
            executionSignal.throwIfAborted()
            throw new VoiceRuntimeError('no_speech')
          }
          throw error
        }
      }, signal)
      let read = false
      const iterator: AsyncIterableIterator<TranscriptRevision> = {
        [Symbol.asyncIterator]() {
          return this
        },
        async next() {
          if (read) return { done: true, value: undefined }
          read = true
          const result = await task.completed
          return {
            done: false,
            value: { revision: 1, text: result.text, provisionalStart: result.text.length, final: true }
          }
        },
        async return() {
          read = true
          await task.cancel()
          return { done: true, value: undefined }
        }
      }
      return { ...task, updates: iterator }
    }
  }
}
