import * as z from 'zod'

import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  MAX_SPEECH_SPEED,
  MIN_SPEECH_SPEED,
  FUNASR_MODEL_ID,
  LOCAL_VOICE_MODEL_IDS,
  type LocalVoiceModelFacts,
  type LocalTranscriptionModelId,
  VOICE_SESSION_SOURCES,
  type VoiceSessionSource,
  VOICE_SESSION_TRIGGERS,
  type VoiceSessionTrigger
} from '@shared/ai/localVoice'
import { FileEntryIdSchema, InternalEntrySchema } from '@shared/data/types/file'
import { voiceErrorCodes, type VoiceErrorReason } from '@shared/ipc/errors/voice'

import { defineRoute } from '../define'

const language = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/)
  .optional()
const session = z.strictObject({ sessionId: z.uuid() })
const request = session.extend({
  requestId: z.uuid(),
  source: z.enum(VOICE_SESSION_SOURCES).optional()
})
const abort = session.extend({ requestId: z.uuid() })
const modelId = z.enum(LOCAL_VOICE_MODEL_IDS)
const asrModelId = z.enum([APPLE_ASR_MODEL_ID, FUNASR_MODEL_ID])
const speechInput = request
  .extend({
    modelId: z.literal(APPLE_TTS_MODEL_ID).optional(),
    text: z.string().trim().min(1).max(10_000),
    voice: z.string().min(1).max(256),
    language,
    trigger: z.enum(VOICE_SESSION_TRIGGERS).optional(),
    chunkIndex: z.number().int().nonnegative().optional(),
    chunkCount: z.number().int().positive().optional(),
    speed: z.number().finite().min(MIN_SPEECH_SPEED).max(MAX_SPEECH_SPEED).optional()
  })
  .refine(
    ({ chunkIndex, chunkCount }) =>
      (chunkIndex === undefined && chunkCount === undefined) ||
      (chunkIndex !== undefined && chunkCount !== undefined && chunkIndex < chunkCount),
    { message: 'Speech chunk metadata must be a complete zero-based range' }
  )

export const VOICE_SESSION_PHASES = [
  'idle',
  'recording',
  'recognizing',
  'generating',
  'playing',
  'paused',
  'completed',
  'failed',
  'aborted'
] as const
export type VoiceSessionPhase = (typeof VOICE_SESSION_PHASES)[number]

export const VOICE_SESSION_COMMANDS = ['pause', 'resume', 'stop'] as const
export type VoiceSessionCommand = (typeof VOICE_SESSION_COMMANDS)[number]

export type VoiceSessionState = {
  sessionId: string
  revision: number
  phase: VoiceSessionPhase
  source?: VoiceSessionSource
  trigger?: VoiceSessionTrigger
  reason?: VoiceErrorReason
}

export type VoiceSessionEvent =
  | ({ type: 'state' } & VoiceSessionState)
  | {
      type: 'command'
      sessionId: string
      revision: number
      command: VoiceSessionCommand
    }

export type VoiceEventSchemas = {
  'ai.voice.session_event': VoiceSessionEvent
}

export const voiceRequestSchemas = {
  'file.voice_recording.create': defineRoute({
    input: session.extend({
      audio: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0 && value.byteLength <= 32 * 1024 * 1024),
      mimeType: z.literal('audio/webm;codecs=opus')
    }),
    output: InternalEntrySchema
  }),
  'ai.speech.generate': defineRoute({
    input: speechInput,
    output: z.strictObject({
      sessionId: z.uuid(),
      requestId: z.uuid(),
      fileEntry: InternalEntrySchema,
      mimeType: z.literal('audio/wav')
    })
  }),
  'ai.speech.abort': defineRoute({ input: abort, output: z.void() }),
  'ai.transcription.generate': defineRoute({
    input: request.extend({ modelId: asrModelId.optional(), fileEntryId: FileEntryIdSchema, language }),
    output: z.strictObject({
      sessionId: z.uuid(),
      requestId: z.uuid(),
      text: z.string(),
      segments: z.array(z.strictObject({ text: z.string(), startSecond: z.number(), endSecond: z.number() })),
      language: z.string().optional(),
      durationInSeconds: z.number().optional()
    })
  }),
  'ai.transcription.abort': defineRoute({ input: abort, output: z.void() }),
  'ai.voice.session.discard': defineRoute({ input: session, output: z.void() }),
  'ai.voice.models.list': defineRoute({
    input: z.void(),
    output: z.custom<{ models: readonly LocalVoiceModelFacts[]; defaultAsrModelId?: LocalTranscriptionModelId }>()
  }),
  'ai.voice.model.status': defineRoute({
    input: z.strictObject({ modelId, language, voice: z.string().min(1).max(256).optional() }),
    output: z.strictObject({
      status: z.enum(['unsupported', 'not_installed', 'installing', 'ready', 'failed']),
      reason: z
        .enum(Object.keys(voiceErrorCodes) as [keyof typeof voiceErrorCodes, ...Array<keyof typeof voiceErrorCodes>])
        .optional()
    })
  }),
  'ai.speech.voices.list': defineRoute({
    input: z.void(),
    output: z.array(z.strictObject({ id: z.string(), name: z.string(), language: z.string() }))
  }),
  'ai.transcription.asset.install': defineRoute({
    input: request.extend({
      language: z
        .string()
        .min(2)
        .max(64)
        .regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/)
    }),
    output: z.void()
  })
}
