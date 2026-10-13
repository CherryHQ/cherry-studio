import type { LanguageModelV3CallOptions, LanguageModelV3Prompt, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import { type AgentSession, defineTool, type ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { type LanguageModel, simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

import {
  createGoalExtension,
  GOAL_NOTICE_TYPE,
  GOAL_ROUND_TYPE,
  GOAL_STATE_TYPE,
  type GoalApprovalEvent,
  type GoalCleared,
  type GoalNotice,
  type GoalPort,
  type GoalSnapshot,
  type RoundDetails,
  type TranscriptEntry
} from '../src'
import { createTestSession, finish, hostStore, plain, streamTextPort, type TestSessionOptions } from './support'

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

/** A script whose replies differ per call, so every round counts as progress. */
export const working = (_prompt: LanguageModelV3Prompt, call: number) => say(`working on step ${call}`)

/** The round a request starts, read from its last message (that round's prompt); undefined for any other request. */
export function roundStart(prompt: LanguageModelV3Prompt): number | undefined {
  const last = prompt.at(-1)
  if (last?.role !== 'user') return undefined
  const text = last.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
  const round = text.startsWith('<goal_round>') ? /\nRound: (\d+)\//.exec(text) : null
  return round ? Number(round[1]) : undefined
}

/**
 * A `goalModel` whose calls wait until `release()`, so a test can act while a turn is in flight. An
 * abort settles the run without a release.
 */
export function heldModel(scripts: Parameters<typeof goalModel>[0] = [() => say('done')]) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const calls: LanguageModelV3CallOptions[] = []
  const waiting: { count: number; resolve: () => void }[] = []
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      const call = calls.push(options)
      for (const waiter of waiting) if (call >= waiter.count) waiter.resolve()
      await gate
      const script = scripts[Math.min(call - 1, scripts.length - 1)]
      return { stream: simulateReadableStream({ chunks: script(options.prompt, call) }) }
    }
  })
  return {
    model,
    calls,
    release,
    /** Resolves once the `n`th call (from 1) is waiting. */
    started: (n: number) =>
      new Promise<void>((resolve) => (calls.length >= n ? resolve() : waiting.push({ count: n, resolve }))),
    aborted: (n: number) => calls[n - 1]?.abortSignal?.aborted === true
  }
}

type GoalSessionOptions = Omit<TestSessionOptions<undefined>, 'port' | 'onEvent'> & {
  /** Loaded after the goal extension, so their settle handlers run after its decision. */
  laterExtensions?: ExtensionFactory[]
}

/**
 * A session on `model` with the goal extension loaded between `extra.extensionFactories` and
 * `extra.laterExtensions`, and a host store.
 */
export async function openGoalSession(
  model: LanguageModel,
  port: GoalPort = goalPort(),
  { laterExtensions = [], ...extra }: GoalSessionOptions = {}
) {
  const host = hostStore()
  const runtime = await createTestSession({
    ...extra,
    port: streamTextPort(model).port,
    extensionFactories: [...(extra.extensionFactories ?? []), createGoalExtension(port), ...laterExtensions],
    onEvent: host.onEvent
  })
  return { ...runtime, host }
}

export async function goalSession(
  scripts: Parameters<typeof goalModel>[0],
  port: GoalPort = goalPort(),
  extra: GoalSessionOptions = {}
) {
  const { model, calls } = goalModel(scripts)
  return { ...(await openGoalSession(model, port, extra)), calls }
}

export async function heldGoalSession(
  port: GoalPort = goalPort(),
  extra: GoalSessionOptions = {},
  scripts?: Parameters<typeof goalModel>[0]
) {
  const held = heldModel(scripts)
  return { ...(await openGoalSession(held.model, port, extra)), held }
}

/** Prompts and waits for the run to settle: a `/goal` command returns before the round it starts ends. */
export async function promptIdle(session: AgentSession, text: string) {
  await session.prompt(text)
  await session.waitForIdle()
}

/** Queues a user message at the `turn`th turn end (from 1); Pi takes it in within the same run. */
export function askAtTurnEnd(session: AgentSession, turn: number) {
  let turns = 0
  session.subscribe((event) => {
    if (event.type !== 'turn_end' || ++turns !== turn) return
    void session.prompt('a question from the user', { streamingBehavior: 'followUp' })
  })
}

/**
 * The transcript of a session cut off while round 1 of `/goal <objective>` waits for the model, as an
 * app crash leaves it: the goal is active and that round admitted.
 */
export async function crashedTranscript(objective: string, port: GoalPort, cwd: string) {
  const { session, host, held } = await heldGoalSession(port, { cwd })
  await session.prompt(`/goal ${objective}`)
  await held.started(1)
  return plain(host.entries)
}

/**
 * A port with a single approval listener, and a tool that reports `kind` for its own call, as the
 * host's approval layer would.
 */
export function approvals(kind: GoalApprovalEvent['kind'], overrides: Parameters<typeof goalPort>[0] = {}) {
  let listener: ((event: GoalApprovalEvent) => void) | undefined
  const port = goalPort({
    ...overrides,
    onApproval: (next) => {
      listener = next
      return () => (listener = undefined)
    }
  })
  const tool = defineTool({
    name: 'risky',
    label: 'Risky',
    description: 'Needs approval',
    parameters: Type.Object({}),
    async execute(id) {
      listener?.({ kind, toolCallId: id })
      return { content: [{ type: 'text', text: `approval ${kind}` }], details: undefined, isError: true }
    }
  })
  return { port, tool }
}

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
