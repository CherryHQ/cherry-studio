import type { LanguageModelV3CallOptions, LanguageModelV3Prompt, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { Type } from '@earendil-works/pi-ai'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { type AgentSession, defineTool, type ExtensionFactory, SessionManager } from '@earendil-works/pi-coding-agent'
import { type LanguageModel, simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { expect, onTestFinished } from 'vitest'

import {
  createAgentRuntimeSession,
  createGoalExtension,
  GOAL_NOTICE_TYPE,
  GOAL_ROUND_TYPE,
  GOAL_STATE_TYPE,
  type GoalApprovalEvent,
  type GoalCleared,
  type GoalNotice,
  type GoalPort,
  type GoalSnapshot,
  type RoundDetails
} from '@cherrystudio/agent-runtime-pi'

import { createTestBinding } from './gatewaySupport'
import {
  createTestSession,
  finish,
  hostStore,
  MODEL,
  plain,
  gatewayModel,
  tempDir,
  type TestSessionOptions,
  textParts
} from './gatewaySupport'

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
      // The view is the first line; an accepted completion adds its closing instruction after it.
      if (output.type === 'text' && typeof output.value === 'string' && output.value.startsWith('{'))
        return JSON.parse(output.value.split('\n', 1)[0])
    }
  }
  return { goal: null }
}

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

export const say = (text: string): LanguageModelV3StreamPart[] => [...textParts('t', text), finish('stop')]

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

const ROUND_PROMPT = /<goal_round>[\s\S]*?<\/goal_round>/g

/** Every goal-round prompt a request carries, oldest first. */
export const roundPrompts = (prompt: LanguageModelV3Prompt): string[] =>
  prompt.flatMap((message) =>
    message.role === 'user'
      ? message.content.flatMap((part) => (part.type === 'text' ? (part.text.match(ROUND_PROMPT) ?? []) : []))
      : []
  )

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

type GoalSessionOptions = Omit<TestSessionOptions, 'port' | 'onEvent'> & {
  /** Loaded after the goal extension, so their settle handlers run after its decision. */
  laterExtensions?: ExtensionFactory[]
  /** The host can stop the native session independently of a tool or user prompt. */
  hostSignal?: AbortSignal
}

/** The goal and usage a session's own `get_goal` reports, read without a model request. */
async function goalViewOf(session: AgentSession): Promise<unknown> {
  const tool = session.getToolDefinition('get_goal')
  if (!tool) return undefined
  const result = await tool.execute('rebuild-check', {}, undefined, undefined, undefined as never)
  return JSON.parse(result.content.map((part) => (part.type === 'text' ? part.text : '')).join(''))
}

/**
 * Spec §6.1: goal state and usage are a function of the branch. Rebuilds a session from `entries`
 * and expects it to report what the live session reported then; a rebuilt goal is always disarmed.
 */
async function expectRebuildAgrees(entries: SessionEntry[], live: unknown, port: GoalPort) {
  const cwd = tempDir('cwd')
  const binding = await createTestBinding({
    model: MODEL,

    port: gatewayModel(goalModel([() => say('unused')]).model).upstream
  })
  const rebuilt = await createAgentRuntimeSession({
    ...binding,
    cwd,
    agentDir: tempDir('agent'),
    systemPrompt: 'You are Cherry.',
    sessionManager: SessionManager.inMemory(cwd, undefined, entries),
    extensionFactories: [createGoalExtension({ ...port, onApproval: undefined })]
  })
  try {
    const view = live as { goal: unknown; activation?: string }
    expect(await goalViewOf(rebuilt.session)).toEqual(view.goal === null ? view : { ...view, activation: 'disarmed' })
  } finally {
    await rebuilt.dispose()
  }
}

/**
 * A session on `model` with the goal extension loaded between `extra.extensionFactories` and
 * `extra.laterExtensions`, and a host store. After the test, a session rebuilt from the entries of
 * each settled run, and of the end, must report the goal the live session reported then.
 */
export async function openGoalSession(
  model: LanguageModel,
  port: GoalPort = goalPort(),
  { laterExtensions = [], hostSignal, ...extra }: GoalSessionOptions = {}
) {
  const host = hostStore()
  const modelPort = gatewayModel(model).upstream
  modelPort.signal = hostSignal
  const checkpoints: { entries: SessionEntry[]; view: Promise<unknown> }[] = []
  const live: { session?: AgentSession } = {}
  const checkpoint = () => {
    if (live.session)
      checkpoints.push({ entries: plain(live.session.sessionManager.getBranch()), view: goalViewOf(live.session) })
  }
  const runtime = await createTestSession({
    ...extra,
    port: modelPort,
    extensionFactories: [...(extra.extensionFactories ?? []), createGoalExtension(port), ...laterExtensions],
    onEvent: (event) => {
      host.onEvent(event)
      if (event.type === 'turn-complete') checkpoint()
    }
  })
  live.session = runtime.session
  onTestFinished(async () => {
    checkpoint()
    for (const { entries, view } of checkpoints) {
      const reported = await view
      if (reported !== undefined) await expectRebuildAgrees(entries, reported, port)
    }
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
 * The entries of a session cut off while round 1 of `/goal <objective>` waits for the model, as an
 * app crash leaves it: the goal is active and that round admitted.
 */
export async function crashedEntries(objective: string, port: GoalPort, cwd: string) {
  const { session, host, held } = await heldGoalSession(port, { cwd })
  await session.prompt(`/goal ${objective}`)
  await held.started(1)
  return plain(host.entries)
}

/**
 * A port with a single approval listener, and a tool that reports `kind` for its own call, as the
 * host's approval layer would. `listening()` tells whether a listener is subscribed.
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
  return { port, tool, listening: () => listener !== undefined }
}

/** Every `cherry.goal` entry in order: snapshots and clear tombstones. */
export const goalStates = (entries: readonly SessionEntry[]) =>
  entries.flatMap((entry) =>
    entry.type === 'custom' && entry.customType === GOAL_STATE_TYPE ? [entry.data as GoalSnapshot | GoalCleared] : []
  )

export const snapshots = (entries: readonly SessionEntry[]): GoalSnapshot[] =>
  goalStates(entries).filter((data): data is GoalSnapshot => !('cleared' in data))

export const lastSnapshot = (entries: readonly SessionEntry[]) => snapshots(entries).at(-1)

export const rounds = (entries: readonly SessionEntry[]) =>
  entries.flatMap((entry) =>
    entry.type === 'custom_message' && entry.customType === GOAL_ROUND_TYPE ? [entry.details as RoundDetails] : []
  )

/** The prompt of every goal-round message, oldest first. */
export const roundTexts = (entries: readonly SessionEntry[]) =>
  entries.flatMap((entry) =>
    entry.type === 'custom_message' && entry.customType === GOAL_ROUND_TYPE
      ? [
          typeof entry.content === 'string'
            ? entry.content
            : entry.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
        ]
      : []
  )

export const goalNotices = (entries: readonly SessionEntry[]): GoalNotice[] =>
  entries.flatMap((entry) =>
    entry.type === 'custom' && entry.customType === GOAL_NOTICE_TYPE ? [entry.data as GoalNotice] : []
  )

export const notices = (entries: readonly SessionEntry[]) => goalNotices(entries).map((notice) => notice.text)
