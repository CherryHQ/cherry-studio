import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { defaultAppHeaders } from '@main/utils/http'
import type {
  PronunciationDiagnosis,
  RealtimeSessionAnswer,
  ScenarioReplyResult,
  SpeechSynthesisResult,
  SpeechTranscriptionResult,
  SpokenEvaluationResult
} from '@shared/ai/speech'
import { ENDPOINT_TYPE, type UniqueModelId } from '@shared/data/types/model'
import { formatApiHost } from '@shared/utils/api'
import * as z from 'zod'

import { customFetch } from '../utils/customFetch'
import { getBaseUrl } from '../utils/provider'
import { diagnosePronunciationFromAudio, synthesizeSpeech, transcribeAudio } from './speechAdapters'
import { SpeechCapabilityResolver } from './SpeechCapabilityResolver'
import { compareSpeechText } from './textSimilarity'

const logger = loggerService.withContext('SpeechSessionService')
const OPENAI_PROVIDER_ID = 'openai'
const DEFAULT_REALTIME_VOICE = 'marin'
const DEFAULT_REALTIME_INSTRUCTIONS = [
  '# Role and Objective',
  'You are an English speaking coach for a Chinese native speaker working toward native-level English.',
  'Run low-latency spoken practice. Keep replies concise and conversational.',
  '',
  '# Coaching Rules',
  'Prefer English. Use Chinese only when the learner asks for explanation or appears blocked.',
  'Correct one or two high-impact issues per turn instead of interrupting every small mistake.',
  'For B1 content, ask for short retells. For B2/C1 content, ask scenario-transfer and opinion questions.',
  'When audio is unclear, ask the learner to repeat instead of guessing.'
].join('\n')

const DEFAULT_TRANSCRIPT_ONLY_PRONUNCIATION: PronunciationDiagnosis = {
  source: 'transcript_only',
  pronunciation: 'Transcript-only evaluation cannot judge pronunciation directly.',
  stress: 'No audio-based stress diagnosis available.',
  intonation: 'No audio-based intonation diagnosis available.',
  pace: 'No audio-based pace diagnosis available.',
  wordLevelNotes: []
}

const EvaluationSchema = z.strictObject({
  correctedText: z.string(),
  modelAnswer: z.string(),
  feedback: z.array(z.string()).max(6),
  omissions: z.array(z.string()).max(20),
  additions: z.array(z.string()).max(20),
  pronunciation: z
    .strictObject({
      source: z.enum(['audio', 'transcript_only']),
      pronunciation: z.string(),
      stress: z.string(),
      intonation: z.string(),
      pace: z.string(),
      wordLevelNotes: z
        .array(
          z.strictObject({
            word: z.string(),
            issue: z.string(),
            suggestion: z.string()
          })
        )
        .max(20)
    })
    .optional()
})

const ScenarioReplySchema = z.strictObject({
  reply: z.string().min(1),
  corrections: z.array(z.string()).max(5),
  usedTargets: z.array(z.string()).max(12),
  feedback: z.array(z.string()).max(5),
  shouldEnd: z.boolean()
})

function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return JSON.parse(fenced?.[1] ?? text)
}

@Injectable('SpeechSessionService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['AiService'])
export class SpeechSessionService extends BaseService {
  private readonly resolver = new SpeechCapabilityResolver()
  private readonly requests = new Map<string, AbortController>()

  capabilities() {
    return this.resolver.resolve()
  }

  async transcribe(input: {
    sessionId: string
    audioBase64: string
    mediaType: string
  }): Promise<SpeechTranscriptionResult> {
    return this.run(input.sessionId, async (signal) => {
      const selection = this.capabilities().models.transcription
      if (!selection) throw new Error('No enabled transcription model is configured')
      logger.info('Speech transcription started', { sessionId: input.sessionId, modelId: selection.uniqueModelId })
      return transcribeAudio(selection, input.audioBase64, input.mediaType, signal)
    })
  }

  async synthesize(input: {
    sessionId: string
    text: string
    voice?: string
    speed?: number
  }): Promise<SpeechSynthesisResult> {
    return this.run(input.sessionId, async (signal) => {
      const selection = this.capabilities().models.synthesis
      if (!selection) throw new Error('No enabled speech synthesis model is configured')
      logger.info('Speech synthesis started', {
        sessionId: input.sessionId,
        modelId: selection.uniqueModelId,
        textLength: input.text.length
      })
      return synthesizeSpeech(selection, input.text, signal, input)
    })
  }

  async evaluate(input: {
    sessionId: string
    mode: 'spoken_recall' | 'shadowing'
    target: string
    meaning?: string
    cefr?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'
    taskInstruction?: string
    transcript: string
    audioBase64?: string
    mediaType?: string
  }): Promise<SpokenEvaluationResult> {
    return this.run(input.sessionId, async (signal) => {
      const model = this.requireChatModel()
      const comparison = compareSpeechText(input.target, input.transcript)
      const prompt = JSON.stringify({
        task: input.mode,
        target: input.target,
        meaning: input.meaning,
        cefr: input.cefr,
        taskInstruction: input.taskInstruction,
        transcript: input.transcript,
        audio: input.audioBase64
          ? {
              available: true,
              mediaType: input.mediaType,
              byteEstimate: Buffer.from(input.audioBase64, 'base64').byteLength,
              note: 'The current evaluator cannot inspect raw audio directly; pronunciation.source must be transcript_only unless an audio-capable evaluator is used.'
            }
          : { available: false },
        deterministicComparison: comparison
      })
      const parsed = await this.generateStructured(
        model.uniqueModelId,
        signal,
        EvaluationSchema,
        prompt,
        [
          'You are an English speaking coach.',
          'Evaluate meaning, grammar, naturalness, and word-level differences.',
          'For pronunciation, stress, intonation, and pace, only report audio-based findings when the evaluator can actually inspect audio.',
          'In this transcript-only evaluator, set pronunciation.source to transcript_only and make audio-prosody fields conservative.',
          'Return JSON only with correctedText, modelAnswer, feedback, omissions, additions, pronunciation.'
        ].join(' ')
      )
      const audioPronunciation = await this.tryDiagnosePronunciationFromAudio(input, signal)
      return {
        ...parsed,
        pronunciation: audioPronunciation ?? parsed.pronunciation ?? DEFAULT_TRANSCRIPT_ONLY_PRONUNCIATION,
        textSimilarity: comparison.similarity,
        model
      }
    })
  }

  async scenarioReply(input: {
    sessionId: string
    scenario: string
    cefr: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'
    targets: string[]
    turns: Array<{ role: 'user' | 'assistant'; text: string }>
    transcript: string
  }): Promise<ScenarioReplyResult> {
    return this.run(input.sessionId, async (signal) => {
      const model = this.requireChatModel()
      const parsed = await this.generateStructured(
        model.uniqueModelId,
        signal,
        ScenarioReplySchema,
        JSON.stringify(input),
        [
          `Role-play at CEFR ${input.cefr}.`,
          'Keep the reply concise and stay inside the scenario.',
          'Correct only errors that materially affect clarity or naturalness.',
          'Use target expressions naturally when possible.',
          'Return JSON only with reply, corrections, usedTargets, feedback, shouldEnd.'
        ].join(' ')
      )
      return { ...parsed, model }
    })
  }

  async createRealtimeSdpAnswer(input: {
    sessionId: string
    sdp: string
    instructions?: string
    voice?: string
  }): Promise<RealtimeSessionAnswer> {
    return this.run(input.sessionId, async (signal) => {
      const selection = this.capabilities().models.realtime
      if (!selection) throw new Error('No enabled OpenAI realtime speech model is configured')

      const provider = providerService.getByProviderId(selection.providerId)
      if (provider.id !== OPENAI_PROVIDER_ID && provider.presetProviderId !== OPENAI_PROVIDER_ID) {
        throw new Error('Realtime speech currently requires an OpenAI provider model')
      }

      const apiKey = providerService.getRotatedApiKey(provider.id)
      if (!apiKey) throw new Error('OpenAI API key is required for realtime speech')

      const model = modelService.getByKey(selection.providerId, selection.modelId)
      const apiModelId = model.apiModelId ?? selection.modelId
      const baseUrl = formatApiHost(
        getBaseUrl(provider, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS) || 'https://api.openai.com'
      )
      const formData = new FormData()
      formData.set('sdp', input.sdp)
      formData.set(
        'session',
        JSON.stringify({
          type: 'realtime',
          model: apiModelId,
          instructions: input.instructions || DEFAULT_REALTIME_INSTRUCTIONS,
          audio: {
            output: {
              voice: input.voice || DEFAULT_REALTIME_VOICE
            }
          }
        })
      )

      logger.info('Realtime SDP exchange started', {
        sessionId: input.sessionId,
        modelId: selection.uniqueModelId
      })
      const response = await customFetch(`${baseUrl}/realtime/calls`, {
        method: 'POST',
        headers: {
          ...defaultAppHeaders(),
          Authorization: `Bearer ${apiKey}`
        },
        body: formData,
        signal
      })
      const sdp = await response.text()
      if (!response.ok) {
        throw new Error(
          `Realtime SDP exchange failed: HTTP ${response.status} ${response.statusText} - ${sdp.slice(0, 500)}`
        )
      }

      logger.info('Realtime SDP exchange completed', {
        sessionId: input.sessionId,
        modelId: selection.uniqueModelId,
        sdpLength: sdp.length
      })
      return { sdp, model: selection }
    })
  }

  cancel(sessionId: string): void {
    this.requests.get(sessionId)?.abort()
  }

  protected async onStop(): Promise<void> {
    for (const controller of this.requests.values()) controller.abort()
    this.requests.clear()
  }

  private requireChatModel() {
    const model = this.capabilities().models.chat
    if (!model) throw new Error('No enabled chat model is configured for English speaking practice')
    return model
  }

  private async tryDiagnosePronunciationFromAudio(
    input: {
      mode: 'spoken_recall' | 'shadowing'
      target: string
      meaning?: string
      cefr?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'
      taskInstruction?: string
      transcript: string
      audioBase64?: string
      mediaType?: string
    },
    signal: AbortSignal
  ): Promise<PronunciationDiagnosis | null> {
    if (!input.audioBase64 || !input.mediaType) return null

    const selection = this.capabilities().models.audioEvaluation
    if (!selection) return null

    try {
      return await diagnosePronunciationFromAudio(
        selection,
        {
          mode: input.mode,
          target: input.target,
          meaning: input.meaning,
          cefr: input.cefr,
          taskInstruction: input.taskInstruction,
          transcript: input.transcript,
          audioBase64: input.audioBase64,
          mediaType: input.mediaType
        },
        signal
      )
    } catch (error) {
      logger.warn('Audio pronunciation diagnosis failed, falling back to transcript-only diagnosis', {
        modelId: selection.uniqueModelId,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  private async generateStructured<T>(
    uniqueModelId: UniqueModelId,
    signal: AbortSignal,
    schema: z.ZodType<T>,
    prompt: string,
    system: string
  ): Promise<T> {
    const generate = (repair?: string) =>
      application.get('AiService').generateText({
        uniqueModelId,
        system: repair ? `${system} Repair the invalid output and return valid JSON only.` : system,
        prompt: repair ? JSON.stringify({ input: prompt, invalidOutput: repair }) : prompt,
        callOverrides: { temperature: 0, maxOutputTokens: 2_000 },
        requestOptions: { signal }
      })
    const first = await generate()
    try {
      return schema.parse(parseJsonObject(first.text))
    } catch {
      const repaired = await generate(first.text)
      return schema.parse(parseJsonObject(repaired.text))
    }
  }

  private async run<T>(sessionId: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.cancel(sessionId)
    const controller = new AbortController()
    this.requests.set(sessionId, controller)
    try {
      return await operation(controller.signal)
    } finally {
      if (this.requests.get(sessionId) === controller) this.requests.delete(sessionId)
    }
  }
}
