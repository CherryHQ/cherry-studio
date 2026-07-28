import type {
  ResolvedSpeechCapabilities,
  ScenarioReplyResult,
  SpeechSynthesisResult,
  SpeechTranscriptionResult,
  SpokenEvaluationResult
} from '@shared/ai/speech'
import * as z from 'zod'

import { defineRoute } from '../define'

const MAX_AUDIO_BASE64_LENGTH = 36_000_000

const SessionIdSchema = z.string().trim().min(1).max(200)

export const speechRequestSchemas = {
  'speech.capabilities': defineRoute({
    input: z.void(),
    output: z.custom<ResolvedSpeechCapabilities>()
  }),
  'speech.transcribe': defineRoute({
    input: z.strictObject({
      sessionId: SessionIdSchema,
      audioBase64: z.string().min(1).max(MAX_AUDIO_BASE64_LENGTH),
      mediaType: z.string().trim().min(1).max(100)
    }),
    output: z.custom<SpeechTranscriptionResult>()
  }),
  'speech.synthesize': defineRoute({
    input: z.strictObject({
      sessionId: SessionIdSchema,
      text: z.string().trim().min(1).max(8_000),
      voice: z.string().trim().min(1).max(100).optional(),
      speed: z.number().min(0.25).max(4).optional()
    }),
    output: z.custom<SpeechSynthesisResult>()
  }),
  'speech.evaluate': defineRoute({
    input: z.strictObject({
      sessionId: SessionIdSchema,
      mode: z.enum(['spoken_recall', 'shadowing']),
      target: z.string().trim().min(1).max(4_000),
      meaning: z.string().trim().max(4_000).optional(),
      transcript: z.string().trim().min(1).max(8_000)
    }),
    output: z.custom<SpokenEvaluationResult>()
  }),
  'speech.scenario_reply': defineRoute({
    input: z.strictObject({
      sessionId: SessionIdSchema,
      scenario: z.string().trim().min(1).max(2_000),
      cefr: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
      targets: z.array(z.string().trim().min(1).max(500)).max(12),
      turns: z
        .array(
          z.strictObject({
            role: z.enum(['user', 'assistant']),
            text: z.string().trim().min(1).max(4_000)
          })
        )
        .max(20),
      transcript: z.string().trim().min(1).max(8_000)
    }),
    output: z.custom<ScenarioReplyResult>()
  }),
  'speech.cancel': defineRoute({
    input: z.strictObject({ sessionId: SessionIdSchema }),
    output: z.void()
  })
}
