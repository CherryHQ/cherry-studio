import { SpeechInputKind, TranscriptionInputKind } from '@shared/ai/voice'

import type { SpeechExecution, SpeechRequest, TranscriptionExecution, TranscriptionRequest } from './executionTypes'
import { getSpeechOperations, getTranscriptionOperations } from './localAdapters'
import { VoiceRuntimeError } from './VoiceRuntimeError'

export function startSpeech(request: SpeechRequest, signal?: AbortSignal): SpeechExecution {
  signal?.throwIfAborted()
  const operation = getSpeechOperations(request.modelId).find(
    (operation) => operation.input === request.input.kind && operation.output === request.output
  )
  if (!operation) throw new VoiceRuntimeError('unsupported')
  if (operation.input === SpeechInputKind.Text && request.input.kind === SpeechInputKind.Text)
    return operation.start(request.input, request.options, signal)
  if (operation.input === SpeechInputKind.TextStream && request.input.kind === SpeechInputKind.TextStream)
    return operation.start(request.input, request.options, signal)
  throw new VoiceRuntimeError('unsupported')
}

export function startTranscription(request: TranscriptionRequest, signal?: AbortSignal): TranscriptionExecution {
  signal?.throwIfAborted()
  const operation = getTranscriptionOperations(request.modelId).find(
    (operation) => operation.input === request.input.kind && operation.output === request.output
  )
  if (!operation) throw new VoiceRuntimeError('unsupported')
  if (operation.input === TranscriptionInputKind.Audio && request.input.kind === TranscriptionInputKind.Audio)
    return operation.start(request.input, request.options, signal)
  if (operation.input === TranscriptionInputKind.PcmStream && request.input.kind === TranscriptionInputKind.PcmStream)
    return operation.start(request.input, request.options, signal)
  throw new VoiceRuntimeError('unsupported')
}
