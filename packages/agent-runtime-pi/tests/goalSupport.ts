import type { LanguageModelV3CallOptions, LanguageModelV3Prompt, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

import {
  GOAL_NOTICE_TYPE,
  GOAL_ROUND_TYPE,
  GOAL_STATE_TYPE,
  type GoalCleared,
  type GoalNotice,
  type GoalPort,
  type GoalSnapshot,
  type RoundDetails,
  type TranscriptEntry
} from '../src'
import { finish } from './support'

export function goalPort(
  overrides: Partial<Omit<GoalPort, 'defaults'>> & { defaults?: Partial<GoalPort['defaults']> } = {}
): GoalPort {
  return {
    modelSupportsTools: () => true,
    ...overrides,
    defaults: {
      maxGoalRounds: 100,
      maxGoalRoundsCeiling: 1000,
      blockedAfter: 3,
      autonomy: () => 'auto',
      ...overrides.defaults
    }
  }
}

/** The goal view the model last read, parsed from the newest goal-tool result in the prompt. */
export function readGoal(prompt: LanguageModelV3Prompt): { goal: GoalSnapshot | null; activation?: string } {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const message = prompt[i]
    if (message.role !== 'tool') continue
    for (const part of message.content) {
      if (part.type !== 'tool-result' || !['get_goal', 'create_goal', 'update_goal'].includes(part.toolName)) continue
      const output = part.output as { type: string; value: unknown }
      if (output.type === 'text') return JSON.parse(output.value as string)
    }
  }
  return { goal: null }
}

export const toolCall = (id: string, toolName: string, input: object): LanguageModelV3StreamPart => ({
  type: 'tool-call',
  toolCallId: id,
  toolName,
  input: JSON.stringify(input)
})

/**
 * A model whose Nth call runs the Nth script with the prompt; scripts may read the goal the model
 * last saw. The last script repeats.
 */
export function goalModel(scripts: ((prompt: LanguageModelV3Prompt, call: number) => LanguageModelV3StreamPart[])[]) {
  const calls: LanguageModelV3CallOptions[] = []
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      calls.push(options)
      const script = scripts[Math.min(calls.length - 1, scripts.length - 1)]
      return { stream: simulateReadableStream({ chunks: script(options.prompt, calls.length) }) }
    }
  })
  return { model, calls }
}

export const say = (text: string): LanguageModelV3StreamPart[] => [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: text },
  { type: 'text-end', id: 't' },
  finish('stop')
]

/** Every `cherry.goal` entry in order: snapshots and clear tombstones. */
export const goalStates = (entries: readonly TranscriptEntry[]) =>
  entries.flatMap((entry) =>
    entry.kind === 'state' && entry.type === GOAL_STATE_TYPE
      ? [entry.data as unknown as GoalSnapshot | GoalCleared]
      : []
  )

export const snapshots = (entries: readonly TranscriptEntry[]): GoalSnapshot[] =>
  goalStates(entries).filter((data): data is GoalSnapshot => !('cleared' in data))

export const lastSnapshot = (entries: readonly TranscriptEntry[]) => snapshots(entries).at(-1)

export const rounds = (entries: readonly TranscriptEntry[]) =>
  entries.flatMap((entry) =>
    entry.kind === 'message' && entry.custom?.type === GOAL_ROUND_TYPE
      ? [entry.custom.details as unknown as RoundDetails]
      : []
  )

export const goalNotices = (entries: readonly TranscriptEntry[]): GoalNotice[] =>
  entries.flatMap((entry) =>
    entry.kind === 'state' && entry.type === GOAL_NOTICE_TYPE ? [entry.data as unknown as GoalNotice] : []
  )

export const notices = (entries: readonly TranscriptEntry[]) => goalNotices(entries).map((notice) => notice.text)
