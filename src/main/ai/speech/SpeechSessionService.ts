import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type {
  ScenarioReplyResult,
  SpeechSynthesisResult,
  SpeechTranscriptionResult,
  SpokenEvaluationResult
} from '@shared/ai/speech'
import type { UniqueModelId } from '@shared/data/types/model'
import * as z from 'zod'

import { synthesizeSpeech, transcribeAudio } from './speechAdapters'
import { SpeechCapabilityResolver } from './SpeechCapabilityResolver'
import { compareSpeechText } from './textSimilarity'

const logger = loggerService.withContext('SpeechSessionService')

const EvaluationSchema = z.strictObject({
  correctedText: z.string(),
  modelAnswer: z.string(),
  feedback: z.array(z.string()).max(6),
  omissions: z.array(z.string()).max(20),
  additions: z.array(z.string()).max(20)
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
      return transcribeAudio(selection, input.audioBase64, signal)
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
      logger.info('Speech synthesis started', { sessionId: input.sessionId, modelId: selection.uniqueModelId })
      return synthesizeSpeech(selection, input.text, signal, input)
    })
  }

  async evaluate(input: {
    sessionId: string
    mode: 'spoken_recall' | 'shadowing'
    target: string
    meaning?: string
    transcript: string
  }): Promise<SpokenEvaluationResult> {
    return this.run(input.sessionId, async (signal) => {
      const model = this.requireChatModel()
      const comparison = compareSpeechText(input.target, input.transcript)
      const prompt = JSON.stringify({
        task: input.mode,
        target: input.target,
        meaning: input.meaning,
        transcript: input.transcript,
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
          'Do not infer pronunciation quality from transcription confidence.',
          'Return JSON only with correctedText, modelAnswer, feedback, omissions, additions.'
        ].join(' ')
      )
      return { ...parsed, textSimilarity: comparison.similarity, model }
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
