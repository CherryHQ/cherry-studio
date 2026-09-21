import * as z from 'zod'

export const systemSpeechErrorCodes = [
  'unsupported_os',
  'unsupported_locale',
  'asset_required',
  'asset_installation_failed',
  'voice_unavailable',
  'transcription_failed',
  'synthesis_failed',
  'cancelled',
  'invalid_request',
  'native_helper_failed',
  'timeout'
] as const

export type SystemSpeechErrorCode = (typeof systemSpeechErrorCodes)[number]

export class SystemSpeechError extends Error {
  constructor(readonly code: SystemSpeechErrorCode) {
    super(code)
    this.name = 'SystemSpeechError'
  }
}

export const installedVoiceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    locale: z.string().min(1),
    quality: z.number().int().nonnegative()
  })
  .strict()

export type InstalledVoice = z.infer<typeof installedVoiceSchema>

export const capabilitiesSchema = z
  .object({
    osVersion: z.string(),
    requestedLocale: z.string(),
    supportedLocale: z.string().nullable(),
    appleAssetStatus: z.enum(['unsupported', 'supported', 'downloading', 'installed']),
    voices: z.array(installedVoiceSchema)
  })
  .strict()

export type CapabilitiesResult = z.infer<typeof capabilitiesSchema>

export const nativeResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      value: z.discriminatedUnion('operation', [
        z.object({ operation: z.literal('capabilities'), result: capabilitiesSchema }).strict(),
        z
          .object({
            operation: z.literal('install_asr_assets'),
            result: z.object({ locale: z.string().min(1), status: z.literal('installed') }).strict()
          })
          .strict(),
        z
          .object({
            operation: z.literal('transcribe'),
            result: z.object({ locale: z.string().min(1), text: z.string() }).strict()
          })
          .strict(),
        z
          .object({
            operation: z.literal('synthesize'),
            result: z
              .object({
                voiceId: z.string().min(1),
                outputPath: z.string().min(1),
                sampleRate: z.number().int().positive(),
                channels: z.number().int().positive(),
                frameCount: z.number().int().positive()
              })
              .strict()
          })
          .strict()
      ])
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.object({ code: z.enum(systemSpeechErrorCodes), message: z.string() }).strict()
    })
    .strict()
])

export type NativeSuccess = Extract<z.infer<typeof nativeResponseSchema>, { ok: true }>['value']

export type NativeRequest =
  | { operation: 'capabilities'; locale: string }
  | { operation: 'install_asr_assets'; locale: string; confirmDownload: true }
  | { operation: 'transcribe'; locale: string; inputPath: string }
  | { operation: 'synthesize'; voiceId: string; text: string; outputPath: string; speed: number }
