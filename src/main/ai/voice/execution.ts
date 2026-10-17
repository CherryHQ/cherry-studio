import type { SpeechExecution, SpeechRequest, TranscriptionExecution, TranscriptionRequest } from './executionTypes'
import { getSpeechOperations, getTranscriptionOperations } from './localAdapters'
import { VoiceRuntimeError } from './VoiceRuntimeError'

export function startSpeech(request: SpeechRequest, signal?: AbortSignal): SpeechExecution {
  signal?.throwIfAborted()
  const operation = getSpeechOperations(request.modelId).find(
    (operation) => operation.input === request.input.kind && operation.output === request.output
  )
  if (!operation) throw new VoiceRuntimeError('unsupported')
  return operation.start(request.input, request.options, signal)
}

export function startTranscription(request: TranscriptionRequest, signal?: AbortSignal): TranscriptionExecution {
  signal?.throwIfAborted()
  const operation = getTranscriptionOperations(request.modelId).find(
    (operation) => operation.input === request.input.kind && operation.output === request.output
  )
  if (!operation) throw new VoiceRuntimeError('unsupported')
  return operation.start(request.input, request.options, signal)
}
