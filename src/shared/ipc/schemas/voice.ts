import * as z from 'zod'

import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  FUNASR_MODEL_ID,
  LOCAL_VOICE_MODEL_IDS,
  type LocalSpeechModelId,
  type LocalTranscriptionModelId,
  type LocalVoiceModelDescriptor,
  type VoiceModelLookup,
  TranscriptionLanguageSource,
  MAX_SPEECH_SPEED,
  MIN_SPEECH_SPEED,
  VOICE_SESSION_SOURCES,
  VOICE_SESSION_TRIGGERS,
  WINDOWS_ASR_MODEL_ID,
  WINDOWS_TTS_MODEL_ID
} from '@shared/ai/localVoice'
import { LOCAL_MODEL_DOWNLOAD_RESULTS } from '@shared/data/presets/localModel'
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
const localeTag = languageTag
const transcriptionLanguage = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal(TranscriptionLanguageSource.ModelDefault) }),
  z.strictObject({ source: z.literal(TranscriptionLanguageSource.Interface), locale: languageTag }),
  z.strictObject({ source: z.literal(TranscriptionLanguageSource.Explicit), locale: languageTag })
])
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
const modelId = z.enum(LOCAL_VOICE_MODEL_IDS)
const asrModelId = z.enum([APPLE_ASR_MODEL_ID, WINDOWS_ASR_MODEL_ID, FUNASR_MODEL_ID])
const speechInput = sessionAdmission
  .extend({
    modelId: z.enum([APPLE_TTS_MODEL_ID, WINDOWS_TTS_MODEL_ID]).optional(),
    text: z.string().trim().min(1).max(10_000),
    voice: z.string().min(1).max(256).optional(),
    preferenceResolution: z.literal(true).optional(),
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
  .refine((value) => value.preferenceResolution === true || value.voice !== undefined, {
    message: 'Speech requires an exact voice unless preference resolution is requested'
  })

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

export const VOICE_SESSION_COMMANDS = ['pause', 'resume', 'retry', 'stop', 'interrupt'] as const
export type VoiceSessionCommand = (typeof VOICE_SESSION_COMMANDS)[number]

const revision = z.number().int().nonnegative()
const playbackControl = z.enum(['pause', 'resume', 'retry', 'stop'])
const voiceReason = z.enum(
  Object.keys(voiceErrorCodes) as [keyof typeof voiceErrorCodes, ...Array<keyof typeof voiceErrorCodes>]
)
export const playbackStateSchema = z.strictObject({
  attemptId: revision,
  commandRevision: revision,
  synthesis: z.enum(['idle', 'generating', 'completed', 'failed']),
  desired: z.enum(['playing', 'paused', 'stopped']),
  observed: z.enum(['empty', 'ready', 'playing', 'paused', 'ended', 'failed']),
  pendingCommand: playbackControl.nullable(),
  availableCommands: z.array(playbackControl),
  failure: z.strictObject({ stage: z.enum(['synthesis', 'playback', 'control']), reason: voiceReason }).optional()
})
export type VoicePlaybackState = z.infer<typeof playbackStateSchema>
export type VoicePlaybackControl = z.infer<typeof playbackControl>

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
    playback: playbackStateSchema.optional(),
    reason: z
      .enum(Object.keys(voiceErrorCodes) as [keyof typeof voiceErrorCodes, ...Array<keyof typeof voiceErrorCodes>])
      .optional()
  })
])
export type VoiceSessionState = z.infer<typeof voiceSessionStateSchema>

export type VoiceSessionEvent =
  | ({ type: 'state' } & VoiceSessionState)
  | { type: 'interruption'; revision: number }
  | {
      type: 'command'
      sessionId: string
      revision: number
      command: VoiceSessionCommand
      playback?: VoicePlaybackState
    }

export type VoiceEventSchemas = {
  'ai.voice.session_event': VoiceSessionEvent
}

const voiceStatus = z.strictObject({
  status: z.enum(['unsupported', 'not_installed', 'installing', 'ready', 'failed']),
  percent: z.number().min(0).max(100).optional(),
  reason: z
    .enum(Object.keys(voiceErrorCodes) as [keyof typeof voiceErrorCodes, ...Array<keyof typeof voiceErrorCodes>])
    .optional()
})
const speechModelId = z.enum([APPLE_TTS_MODEL_ID, WINDOWS_TTS_MODEL_ID])

export const voiceRequestSchemas = {
  'ai.voice.resources.open_settings': defineRoute({ input: z.void(), output: z.void() }),
  'ai.voice.transcription.resolve': defineRoute({
    input: z.strictObject({ modelId: asrModelId.optional(), language: transcriptionLanguage.optional() }),
    output: z.strictObject({
      modelId: asrModelId.optional(),
      language: transcriptionLanguage.optional(),
      status: voiceStatus
    })
  }),
  'ai.voice.speech.resolve': defineRoute({
    input: z.strictObject({
      modelId: speechModelId.optional(),
      voice: z.string().min(1).max(256).optional(),
      language,
      speed: z.number().finite().min(MIN_SPEECH_SPEED).max(MAX_SPEECH_SPEED).optional()
    }),
    output: z.strictObject({
      modelId: speechModelId.optional(),
      voice: z.string().optional(),
      language,
      speed: z.number(),
      status: voiceStatus
    })
  }),
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
      output: z.strictObject({ id: z.uuid(), url: z.url(), mimeType: z.literal('audio/wav') }),
      playback: playbackStateSchema,
      resolved: z
        .strictObject({
          modelId: speechModelId,
          voice: z.string().min(1).max(256),
          language,
          speed: z.number().finite().min(MIN_SPEECH_SPEED).max(MAX_SPEECH_SPEED)
        })
        .optional()
    })
  }),
  'ai.speech.abort': defineRoute({ input: abort, output: z.void() }),
  'ai.transcription.generate': defineRoute({
    input: request.extend({
      modelId: asrModelId.optional(),
      fileEntryId: FileEntryIdSchema,
      language: transcriptionLanguage.optional()
    }),
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
  'ai.voice.output.release': defineRoute({ input: session.extend({ outputId: z.uuid() }), output: z.void() }),
  'ai.voice.playback.report': defineRoute({
    input: session.extend({
      attemptId: revision,
      commandRevision: revision,
      phase: z.enum(['playing', 'paused', 'ended', 'completed', 'stopped', 'failed']),
      reason: voiceReason.optional()
    }),
    output: voiceSessionStateSchema
  }),
  'ai.voice.playback.control': defineRoute({
    input: session.extend({ command: playbackControl }),
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
    output: z.custom<{
      models: readonly LocalVoiceModelDescriptor[]
      defaultAsrModelId?: LocalTranscriptionModelId
      defaultSpeechModelId?: LocalSpeechModelId
    }>()
  }),
  'ai.voice.model.describe': defineRoute({
    input: z.strictObject({ modelId: z.string().min(1).max(256) }),
    output: z.custom<VoiceModelLookup>()
  }),
  'ai.voice.model.download': defineRoute({
    input: z.strictObject({ modelId: asrModelId }),
    output: z.enum(LOCAL_MODEL_DOWNLOAD_RESULTS)
  }),
  'ai.voice.model.cancel_download': defineRoute({ input: z.strictObject({ modelId: asrModelId }), output: z.void() }),
  'ai.voice.model.remove': defineRoute({
    input: z.strictObject({ modelId: asrModelId }),
    output: z.strictObject({ removed: z.boolean() })
  }),
  'ai.transcription.locales.list': defineRoute({
    input: z.strictObject({ modelId: asrModelId }),
    output: z.strictObject({ supported: z.array(localeTag), installed: z.array(localeTag) })
  }),
  'ai.voice.model.status': defineRoute({
    input: z.strictObject({ modelId, language, voice: z.string().min(1).max(256).optional() }),
    output: z.strictObject({
      status: z.enum(['unsupported', 'not_installed', 'installing', 'ready', 'failed']),
      percent: z.number().min(0).max(100).optional(),
      reason: z
        .enum(Object.keys(voiceErrorCodes) as [keyof typeof voiceErrorCodes, ...Array<keyof typeof voiceErrorCodes>])
        .optional()
    })
  }),
  'ai.speech.voices.list': defineRoute({
    input: z.strictObject({ modelId: z.enum([APPLE_TTS_MODEL_ID, WINDOWS_TTS_MODEL_ID]) }),
    output: z.array(z.strictObject({ id: z.string(), name: z.string(), language: z.string() }))
  }),
  'ai.transcription.asset.install': defineRoute({
    input: request.extend({
      modelId: asrModelId,
      language: languageTag
    }),
    output: z.void()
  })
}
