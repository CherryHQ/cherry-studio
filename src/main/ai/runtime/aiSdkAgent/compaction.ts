/**
 * Durable compaction for the `ai-sdk` agent runtime (plan D10).
 *
 * One bounded summarization request folds the oldest replayable prefix —
 * including any prior summary — into a new summary, then persists the
 * checkpoint. Row selection reuses `loadReplayContext`, so what gets
 * summarized is exactly what replay would otherwise resend. The connection
 * owns all event emission (`compaction-start/-complete/-error`) and the
 * manual/auto wiring; this module only orchestrates rows → summary → state.
 *
 * Failure atomicity: `saveState` runs only after a non-empty summary is
 * generated, so any throw leaves the previous checkpoint (and replay) intact.
 */

import { agentSessionRuntimeStateService } from '@data/services/AgentSessionRuntimeStateService'
import { toModelMessages } from '@main/ai/messages/messageRules'
import type { AgentSessionCompactionAnchorData, AgentSessionCompactionTrigger } from '@shared/ai/agentSessionCompaction'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ModelMessage, UIMessage } from 'ai'
import { approximateTokenSize } from 'tokenx'

import type { SdkConfig } from '../aiSdk'
import { Agent } from '../aiSdk'
import { AI_SDK_RUNTIME_TYPE, buildSummaryUiMessage, loadReplayContext, toReplayUiMessages } from './sessionHistory'

/** Auto-compact when measured occupancy reaches this; the remaining 20% is the reserved output/tool budget. */
export const AUTO_COMPACT_THRESHOLD_PERCENT = 80

/** Most recent durable rows kept verbatim (≈2 exchanges). Fixed count is the
 *  v1 ceiling; a token-share tail is the upgrade if real sessions need it. */
export const COMPACTION_RETAIN_TAIL_MESSAGES = 4

const SUMMARIZATION_SYSTEM_PROMPT = [
  'You are compacting an agent session so it can continue with less context.',
  'Produce a dense, factual summary of the conversation you are given. Preserve:',
  "the user's goals and constraints, decisions made and why, exact file paths,",
  'identifiers and commands that matter, the current state of the work, unresolved',
  'problems, and what should happen next. Do not invent information, do not add',
  'pleasantries, and do not describe the summarization itself. Output only the summary.'
].join(' ')

export interface CompactSessionInput {
  sessionId: string
  /** Exclusive upper bound: the current turn's durable user row. */
  boundaryMessageId: string
  trigger: AgentSessionCompactionTrigger
  /** Optional `/compact <focus>` emphasis, threaded into the instruction. */
  focus?: string
  /** Provider/model execution config of the current turn (agent system prompt and options are NOT reused). */
  sdkConfig: SdkConfig
  /** The session's pinned model id, persisted for checkpoint provenance. */
  modelId: UniqueModelId
  /** Latest measured occupancy, if any — anchor metrics are never fabricated. */
  preTokens?: number
  signal?: AbortSignal
}

/**
 * Summarize everything replayable before `boundaryMessageId` except the
 * retained tail, persist the checkpoint, and return the anchor metrics.
 * Returns `null` (no write, no anchor) when there is nothing to compact.
 */
export async function compactSession(input: CompactSessionInput): Promise<AgentSessionCompactionAnchorData | null> {
  const startedAt = Date.now()
  const { state, rows } = loadReplayContext(input.sessionId, input.boundaryMessageId)

  const prefixRows = rows.slice(0, Math.max(0, rows.length - COMPACTION_RETAIN_TAIL_MESSAGES))
  if (prefixRows.length === 0) return null

  // The prior summary enters as the same synthetic message replay uses, so
  // repeated compaction folds it forward instead of dropping pre-anchor facts.
  const prefixUiMessages = [
    ...(state ? [buildSummaryUiMessage(state)] : []),
    ...toReplayUiMessages(prefixRows)
  ] as unknown as UIMessage[]
  const prefixModelMessages = await toModelMessages(prefixUiMessages)
  const sourceTokenCount = estimateModelMessageTokens(prefixModelMessages)

  const summarizer = new Agent({
    providerId: input.sdkConfig.providerId,
    providerSettings: input.sdkConfig.providerSettings,
    modelId: input.sdkConfig.modelId,
    tools: {},
    system: SUMMARIZATION_SYSTEM_PROMPT
  })
  const { text } = await summarizer.generate(
    { messages: [...prefixModelMessages, buildSummarizationInstruction(input.focus)] },
    input.signal
  )
  const summary = text.trim()
  if (!summary) {
    throw new Error('Compaction model returned an empty summary; previous state kept.')
  }

  const summaryTokenCount = approximateTokenSize(summary)
  agentSessionRuntimeStateService.saveState({
    sessionId: input.sessionId,
    runtimeType: AI_SDK_RUNTIME_TYPE,
    compactedThroughMessageId: prefixRows[prefixRows.length - 1].id,
    summary,
    summaryTokenCount,
    sourceTokenCount,
    compactionModelId: input.modelId
  })

  const anchor: AgentSessionCompactionAnchorData = {
    trigger: input.trigger,
    completedAt: new Date().toISOString(),
    postTokens: summaryTokenCount,
    durationMs: Date.now() - startedAt
  }
  if (typeof input.preTokens === 'number') anchor.preTokens = input.preTokens
  return anchor
}

function buildSummarizationInstruction(focus: string | undefined): ModelMessage {
  const base = 'Summarize the conversation above now.'
  return { role: 'user', content: focus ? `${base}\nPay special attention to: ${focus}` : base }
}

/** Metrics-only token estimate over the summarization input (text and serialized tool parts). */
function estimateModelMessageTokens(messages: readonly ModelMessage[]): number {
  let total = 0
  for (const message of messages) {
    if (typeof message.content === 'string') {
      total += approximateTokenSize(message.content)
      continue
    }
    for (const part of message.content) {
      if ('text' in part && typeof part.text === 'string') total += approximateTokenSize(part.text)
      else total += approximateTokenSize(JSON.stringify(part))
    }
  }
  return total
}
