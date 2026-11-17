import { getMessageGenerationSample } from '@renderer/components/chat/messages/frame/messagePerformance'
import type { CherryMessagePart, CherryUIMessage, MessageStats } from '@shared/data/types/message'

export interface AgentSessionMetrics {
  turns: number
  toolSteps: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cacheHitRate?: number
  timeFirstTokenMs?: number
  tokensPerSecond?: number
}

function sumDefined(values: ReadonlyArray<number | undefined>): number | undefined {
  let total: number | undefined
  for (const value of values) {
    if (value !== undefined) total = (total ?? 0) + value
  }
  return total
}

function isToolPart(type: string): boolean {
  return type.startsWith('tool-') || type === 'dynamic-tool'
}

export function buildAgentSessionMetrics(
  messages: readonly CherryUIMessage[],
  partsByMessageId: Readonly<Record<string, readonly CherryMessagePart[]>>
): AgentSessionMetrics {
  // A completed assistant turn counts by its completion status, not by the presence of usage
  // stats: forking a session preserves successful messages and tool parts but clears stats,
  // and a stats-only gate would report zero turns/steps for the forked history.
  const turns: Array<{ id: string; stats?: MessageStats }> = []
  for (const message of messages) {
    if (message.role === 'assistant' && message.status === 'success') {
      turns.push({ id: message.id, stats: message.metadata?.stats })
    }
  }

  // Usage aggregates still come from stats alone; missing stats leave the field undefined
  // rather than undercounting a partial sum as if it were complete.
  const statsList = turns.map((turn) => turn.stats).filter((stats): stats is MessageStats => stats !== undefined)
  const inputTokens = sumDefined(statsList.map((stats) => stats.inputTokens))
  const cacheReadTokens = sumDefined(statsList.map((stats) => stats.inputTokenDetails?.cacheReadTokens))
  const samples = statsList.map(getMessageGenerationSample).filter((sample) => sample !== undefined)
  const firstTokenValues = statsList
    .map((stats) => stats.timeFirstTokenMs)
    .filter((value): value is number => value !== undefined)
  const generatedTokens = sumDefined(samples.map((sample) => sample.outputTokens))
  const generatedDurationMs = sumDefined(samples.map((sample) => sample.durationMs))

  return {
    turns: turns.length,
    toolSteps: turns.reduce(
      (count, turn) => count + (partsByMessageId[turn.id] ?? []).filter((part) => isToolPart(part.type)).length,
      0
    ),
    inputTokens,
    outputTokens: sumDefined(statsList.map((stats) => stats.outputTokens)),
    cacheReadTokens,
    cacheWriteTokens: sumDefined(statsList.map((stats) => stats.inputTokenDetails?.cacheWriteTokens)),
    cacheHitRate:
      cacheReadTokens !== undefined && inputTokens !== undefined && inputTokens > 0
        ? cacheReadTokens / inputTokens
        : undefined,
    timeFirstTokenMs:
      firstTokenValues.length > 0
        ? firstTokenValues.reduce((sum, value) => sum + value, 0) / firstTokenValues.length
        : undefined,
    tokensPerSecond:
      generatedTokens !== undefined && generatedDurationMs !== undefined && generatedDurationMs > 0
        ? generatedTokens / (generatedDurationMs / 1000)
        : undefined
  }
}
