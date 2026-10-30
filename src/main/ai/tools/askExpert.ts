/**
 * ask_expert — consult a stronger, tool-less model with one self-contained question.
 *
 * The expert model is chosen per Agent (`expertModel`). This module owns the prompt
 * contract and the one-shot model call; the `cherry-tools` MCP server owns the
 * per-session call budget and the model-facing result formatting.
 */

import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import type { AskExpertInput, AskExpertQuestionType } from '@shared/ai/builtinTools'
import type { UniqueModelId } from '@shared/data/types/model'

const logger = loggerService.withContext('AskExpert')

/** Per-session consultation budget, matching Claude Code's advisor default. */
export const ASK_EXPERT_MAX_USES = 8
export const ASK_EXPERT_MAX_OUTPUT_TOKENS = 4_096
export const ASK_EXPERT_TEMPERATURE = 0.3

export type AskExpertFailureCode = 'not_configured' | 'unavailable' | 'aborted'

export type AskExpertResult =
  | {
      ok: true
      text: string
      model: UniqueModelId
      inputTokens?: number
      outputTokens?: number
    }
  | { ok: false; code: AskExpertFailureCode; message: string }

const QUESTION_TYPE_GUIDANCE: Record<AskExpertQuestionType, string> = {
  code_debug:
    'This is a debugging question. Lead with the root cause, then the smallest change that tests it. ' +
    'Name the exact verification command or test that would confirm the diagnosis, and state what evidence ' +
    'would falsify it.',
  math_reasoning:
    'This is a quantitative reasoning question. Show intermediate steps that can be substituted back or ' +
    'independently recomputed. Flag any numerical assumption and its sensitivity.',
  open_research:
    'This is an open research question. Decompose it against the stated review criteria, label each claim ' +
    'by evidence strength (primary source / secondary source / inference), and separate facts from judgments.',
  other: 'Answer directly and decisively. Make assumptions explicit and name the evidence that would change the answer.'
}

export function buildExpertSystemPrompt(questionType: AskExpertQuestionType): string {
  return `You are the expert: a senior reviewer consulted by an AI agent that cannot show you its tools or files.
You receive one self-contained question. You have no tools and no memory, and you cannot ask follow-ups.

Your job is to produce a decisive, verifiable answer:
- Ground every claim in the supplied context; mark inferences as inferences.
- If the question lacks information you need, say exactly what is missing and what evidence would resolve it, then answer what you can.
- Prefer concrete, checkable steps over general advice.
- Answer in the language of the question.

${QUESTION_TYPE_GUIDANCE[questionType]}

Structure your reply as:
1. VERDICT — one line.
2. ADVICE — specific changes or confirmations, most important first.
3. RISKS — anything the caller has not accounted for, if any.
4. MISSING — only when the answer is blocked on information the caller did not supply.`
}

export function buildExpertUserPrompt(input: AskExpertInput): string {
  const sections = [
    `## Objective\n${input.objective}`,
    `## Context\n${input.context}`,
    `## Already tried\n${input.attempts?.trim() || 'Nothing yet.'}`,
    `## Boundaries\n${input.boundaries?.trim() || 'None stated.'}`,
    `## Required output format\n${input.output_format}`
  ]
  return sections.join('\n\n')
}

function failure(code: AskExpertFailureCode, message: string): AskExpertResult {
  return { ok: false, code, message }
}

/** One consultation call. The caller owns the per-session budget. */
export async function askExpert(
  input: AskExpertInput,
  options: { agentId: string; signal?: AbortSignal }
): Promise<AskExpertResult> {
  const agent = agentService.getAgent(options.agentId)
  if (!agent) return failure('not_configured', `Agent not found: ${options.agentId}`)

  const model = agent.expertModel
  if (!model) {
    return failure(
      'not_configured',
      'No expert model is configured for this Agent. Open the Agent settings and select an "Expert model" ' +
        'for ask_expert, then retry.'
    )
  }

  const questionType = input.question_type ?? 'other'
  logger.info('ask_expert call', {
    agentId: options.agentId,
    model,
    questionType,
    contextChars: input.context.length
  })

  try {
    const result = await application.get('AiService').generateText({
      uniqueModelId: model,
      conversation: { id: `ask-expert:${randomUUID()}` },
      system: buildExpertSystemPrompt(questionType),
      messages: [{ role: 'user', content: buildExpertUserPrompt(input) }],
      disableTools: true,
      callOverrides: {
        maxOutputTokens: ASK_EXPERT_MAX_OUTPUT_TOKENS,
        temperature: ASK_EXPERT_TEMPERATURE
      },
      requestOptions: { signal: options.signal }
    })

    const text = result.text.trim()
    if (!text) {
      return failure('unavailable', 'The expert model returned an empty answer. Check the configured model and retry.')
    }

    return {
      ok: true,
      text,
      model,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens
    }
  } catch (error) {
    if (options.signal?.aborted) return failure('aborted', 'The expert call was aborted.')
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('ask_expert call failed', { agentId: options.agentId, model, error: message })
    return failure('unavailable', `Expert model call failed: ${message}`)
  }
}

export function formatAskExpertResult(result: Extract<AskExpertResult, { ok: true }>, call: number, maxUses: number) {
  const usage =
    result.inputTokens === undefined && result.outputTokens === undefined
      ? ''
      : ` · tokens in/out: ${result.inputTokens ?? '?'}/${result.outputTokens ?? '?'}`
  return (
    `Expert answer (candidate, verify before adopting)\n` +
    `model: ${result.model}${usage} · call ${call}/${maxUses}\n\n` +
    `${result.text}\n\n---\n` +
    `This is a candidate hypothesis, not a conclusion. Check its claims against primary evidence before acting; ` +
    `do not adopt it merely because it is confident.`
  )
}
