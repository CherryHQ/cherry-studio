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
  VOICE_SESSION_TRIGGERS
} from '@shared/ai/localVoice'
import { FileEntryIdSchema, InternalEntrySchema } from '@shared/data/types/file'
import { voiceErrorCodes } from '@shared/ipc/errors/voice'

import { defineRoute } from '../define'

const languageTag = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/)
  .refine((value) => value.toLowerCase() !== 'auto')
const language = languageTag.optional()
const session = z.strictObject({ sessionId: z.uuid() })
const request = session.extend({
  requestId: z.uuid(),
  source: z.enum(VOICE_SESSION_SOURCES).optional()
})
const sourceEntityId = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim())
const sessionAdmission = request.extend({ sourceEntityId: sourceEntityId.optional() })
const abort = session.extend({ requestId: z.uuid() })
const sessionFile = session.extend({ fileEntryId: FileEntryIdSchema })
const modelId = z.enum(LOCAL_VOICE_MODEL_IDS)
const asrModelId = z.enum([APPLE_ASR_MODEL_ID, FUNASR_MODEL_ID])
const speechInput = sessionAdmission
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
  'recorded',
  'recognizing',
  'generating',
  'ready',
  'playing',
  'paused',
  'failed'
] as const
export type VoiceSessionPhase = (typeof VOICE_SESSION_PHASES)[number]

export const VOICE_SESSION_COMMANDS = ['pause', 'resume', 'stop'] as const
export type VoiceSessionCommand = (typeof VOICE_SESSION_COMMANDS)[number]

const revision = z.number().int().nonnegative()
const activePhase = z.enum(
  VOICE_SESSION_PHASES.filter((phase) => phase !== 'idle') as [
    Exclude<VoiceSessionPhase, 'idle'>,
    ...Array<Exclude<VoiceSessionPhase, 'idle'>>
  ]
)
export const voiceSessionStateSchema = z.union([
  z.strictObject({ revision, phase: z.literal('idle') }),
  session.extend({
    revision,
    phase: activePhase,
    source: z.enum(VOICE_SESSION_SOURCES).optional(),
    trigger: z.enum(VOICE_SESSION_TRIGGERS).optional(),
    reason: z
      .enum(Object.keys(voiceErrorCodes) as [keyof typeof voiceErrorCodes, ...Array<keyof typeof voiceErrorCodes>])
      .optional()
  })
])
export type VoiceSessionState = z.infer<typeof voiceSessionStateSchema>

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
      mimeType: z.literal('audio/webm;codecs=opus'),
      durationMs: z.number().int().min(0).max(300_000)
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
  'ai.voice.session.state': defineRoute({ input: z.void(), output: voiceSessionStateSchema }),
  'ai.voice.recording.start': defineRoute({ input: sessionAdmission, output: voiceSessionStateSchema }),
  'ai.voice.output.read': defineRoute({
    input: sessionFile,
    output: z.strictObject({
      audio: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0),
      mimeType: z.literal('audio/wav')
    })
  }),
  'ai.voice.output.release': defineRoute({ input: sessionFile, output: z.void() }),
  'ai.voice.playback.update': defineRoute({
    input: session.extend({
      phase: z.enum(['playing', 'paused', 'completed', 'failed']),
      reason: z
        .enum(Object.keys(voiceErrorCodes) as [keyof typeof voiceErrorCodes, ...Array<keyof typeof voiceErrorCodes>])
        .optional()
    }),
    output: voiceSessionStateSchema
  }),
  'ai.voice.playback.control': defineRoute({
    input: session.extend({ command: z.enum(VOICE_SESSION_COMMANDS) }),
    output: voiceSessionStateSchema
  }),
  'ai.voice.microphone.status': defineRoute({
    input: z.void(),
    output: z.enum(['not-determined', 'granted', 'denied', 'restricted', 'unknown'])
  }),
  'ai.voice.microphone.open_settings': defineRoute({ input: z.void(), output: z.void() }),
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
      language: languageTag
    }),
    output: z.void()
  })
}
