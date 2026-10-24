import type { Api, Model } from '@earendil-works/pi-ai'
import {
  type AgentSession,
  createAgentSession,
  type CreateAgentSessionOptions,
  createEventBus,
  DefaultResourceLoader,
  type ExtensionFactory,
  type ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition
} from '@earendil-works/pi-coding-agent'

import { type AgentRuntimeCompaction, compactionSummaryExtension } from './compaction'
import { type ToolOutputOffload, toolOutputOffloadExtension } from './offload'
import { recallExtension } from './recall'
import { type AgentRuntimeEvent, SessionEvents } from './sessionEvents'
import { createSubagentExtension, type SubagentPort } from './subagent'

export type AgentRuntimeModel = Model<Api>

export type AgentRuntimeSettings = Omit<NonNullable<Parameters<typeof SettingsManager.inMemory>[0]>, 'compaction'>

export interface AgentRuntimeSessionOptions {
  /** Borrowed native runtime; the caller owns provider registration and credentials. */
  modelRuntime: ModelRuntime
  model: AgentRuntimeModel
  /** Working directory for Pi's built-in tools and the `<cwd>` prompt section. */
  cwd: string
  /** Pi's agent directory; keeps Pi off its `~/.pi/agent` default. Only context files are ever read from it. */
  agentDir: string
  /** Replaces Pi's default prompt; Pi's own prompt when omitted. Pi still appends a `<cwd>` section. */
  systemPrompt?: string
  /** Added after the system prompt. */
  appendSystemPrompt?: string[]
  /** Load `AGENTS.md` / `CLAUDE.md` from `cwd`, its ancestors and `agentDir` (a user-chosen, trusted workspace). */
  contextFiles?: boolean
  /** Skill directories the host enables; loaded although skill discovery stays off. */
  skillPaths?: string[]
  /** Native storage owner. Defaults to an in-memory session; pass create/open for persistence. */
  sessionManager?: SessionManager
  /** Native entry observations and turn events; never used to restore the session. Must not throw. */
  onEvent?: (event: AgentRuntimeEvent) => void
  compaction?: AgentRuntimeCompaction
  offload?: ToolOutputOffload
  recall?: boolean
  subagents?: SubagentPort
  tools?: ToolDefinition[]
  /** Pi built-in tools to enable, e.g. `read`, `bash`. None by default. */
  builtinTools?: string[]
  extensionFactories?: ExtensionFactory[]
  settings?: AgentRuntimeSettings
  /** Native Pi thinking level (default `off`). */
  thinkingLevel?: CreateAgentSessionOptions['thinkingLevel']
}

/** Pi event-bus channel: the host's `abort()` is stopping the running run for the user. */
export const USER_ABORT = 'cherry.user-abort'

export interface AgentRuntimeSession {
  session: AgentSession
  /** Aborts the running turn, lets extensions shut down, then disposes the session. */
  dispose(): Promise<void>
  /**
   * `session.prompt`, for every user turn the host starts: until Pi starts the run (while commands and
   * `input` handlers run), it reports the session idle, and a background result must not start a run
   * then. Called while a run settles (from `onEvent`'s `turn-complete`), it runs once that settle and
   * any run Pi started meanwhile are over, and resolves or rejects as that prompt does.
   */
  prompt(text: string, options?: Parameters<AgentSession['prompt']>[1]): Promise<void>
  /** `session.compact`, for every manual compaction the host starts, for the same reason. */
  compact(customInstructions?: string): Promise<void>
  /**
   * `session.abort()`, for every stop the user makes (the host's stop button): it counts as the
   * user's even when it lands in a run the runtime is ending itself (a goal withdrawing a round).
   */
  abort(): Promise<void>
  /** The user stops a background subagent (the host's stop button); false when it is not running. */
  stopSubagent(sessionId: string): boolean
  /**
   * The user moves a running foreground subagent to the background: its call returns at once and
   * the same run goes on, ending in a notification. False for any other subagent.
   */
  backgroundSubagent(sessionId: string): boolean
}

/**
 * Builds a Pi agent session using the caller's native model runtime and native session storage.
 * Workspace context files and skills load only when the host opts in.
 */
export async function createAgentRuntimeSession(options: AgentRuntimeSessionOptions): Promise<AgentRuntimeSession> {
  return buildSession(options)
}

async function buildSession(
  options: AgentRuntimeSessionOptions,
  beforeModelRequest?: () => void
): Promise<AgentRuntimeSession> {
  const { cwd, agentDir } = options
  const { modelRuntime, model } = options
  const sessionManager = options.sessionManager ?? SessionManager.inMemory(cwd)
  const events = new SessionEvents(sessionManager, options.onEvent ?? (() => {}))
  // Pi defers a prompt made while it dispatches agent_settled and returns before it runs; `held` waits instead.
  let settling: { over: Promise<void>; end: () => void } | undefined
  const settleWatch: ExtensionFactory = (pi) => {
    pi.on('agent_settled', () => {
      let end!: () => void
      settling = { over: new Promise((resolve) => (end = resolve)), end }
    })
  }

  const { compaction } = options
  const summarize = compaction?.summarize
    ? (request: Parameters<NonNullable<AgentRuntimeCompaction['summarize']>>[0]) => {
        beforeModelRequest?.()
        return compaction.summarize!(request)
      }
    : undefined

  const subagents =
    options.subagents &&
    createSubagentExtension({
      port: options.subagents,
      // A fork keeps `subagent` so its tools match the parent's; a fresh subagent has none.
      createSession: ({ fork, beforeModelRequest: beforeChildRequest, ...overrides }) =>
        buildSession(
          {
            ...options,
            ...overrides,
            modelRuntime: overrides.modelRuntime ?? options.modelRuntime,
            subagents: fork ? options.subagents : undefined
          },
          beforeChildRequest
        ),
      parentSession: sessionManager,
      parentModel: options.model,
      emit: (event) => options.onEvent?.(event),
      offload: options.offload
    })
  const extensionFactories = [
    // First, so the watch covers every other extension's agent_settled handler.
    settleWatch,
    ...(summarize ? [compactionSummaryExtension(summarize, (message) => (events.summaryFailure = message))] : []),
    ...(options.recall ? [recallExtension(() => sessionManager.getBranch())] : []),
    ...(subagents ? [subagents.extension] : []),
    ...(options.extensionFactories ?? []),
    // Last, so it sees what other `tool_result` handlers made of the output.
    ...(options.offload ? [toolOutputOffloadExtension(options.offload)] : [])
  ]
  const settingsManager = SettingsManager.inMemory({
    ...options.settings,
    // Pi's cache warmer requests bypass `agent.streamFunction`, where a subagent's requests are counted.
    ...(beforeModelRequest && { cacheWarming: 'off' as const }),
    ...(compaction && {
      compaction: {
        enabled: compaction.enabled ?? true,
        reserveTokens: compaction.reserveTokens,
        keepRecentTokens: compaction.keepRecentTokens
      }
    })
  })
  const eventBus = createEventBus()
  const resourceLoader = new DefaultResourceLoader({
    eventBus,
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: !options.contextFiles,
    additionalSkillPaths: options.skillPaths,
    extensionFactories,
    // Overriding (even with undefined) keeps disk-discovered SYSTEM.md / APPEND_SYSTEM.md out.
    systemPromptOverride: () => options.systemPrompt,
    appendSystemPromptOverride: () => options.appendSystemPrompt ?? []
  })
  await resourceLoader.reload()

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    settingsManager,
    sessionManager,
    resourceLoader,
    model,
    thinkingLevel: options.thinkingLevel ?? 'off',
    noTools: 'builtin',
    // `+name` entries add to the (empty) built-in selection without restricting custom/extension tools.
    tools: options.builtinTools?.length ? options.builtinTools.map((name) => `+${name}`) : undefined,
    customTools: options.tools ?? []
  })
  if (beforeModelRequest) {
    const stream = session.agent.streamFunction
    session.agent.streamFunction = (model, context, options) => {
      beforeModelRequest()
      return stream(model, context, options)
    }
  }
  session.subscribe((event) => {
    events.handle(event)
    if (event.type !== 'agent_settled') return
    settling?.end()
    settling = undefined
  })
  // State entries are in the session before extensions bind, so `session_start` sees them.
  await session.bindExtensions({})
  const baseTools = session.getActiveToolNames()
  events.setBaseTools(baseTools)
  if (events.activatedTools.length > 0) session.setActiveToolsByName([...baseTools, ...events.activatedTools])

  events.flush()

  const held = async (run: () => Promise<unknown>) => {
    const release = subagents?.controls.hold() ?? (() => {})
    try {
      if (settling) {
        await settling.over
        // A run Pi deferred during the settle (a notification) goes first, as Pi would order them.
        await session.waitForIdle()
      }
      await run()
    } finally {
      release()
    }
  }
  return {
    session,
    prompt: (text, promptOptions) => held(() => session.prompt(text, promptOptions)),
    compact: (customInstructions) => held(() => session.compact(customInstructions)),
    abort() {
      // Pi reports a run aborted only when one is active; that run's abort is the user's.
      if (session.isStreaming) {
        eventBus.emit(USER_ABORT, undefined)
        subagents?.controls.userAbort()
      }
      return session.abort()
    },
    stopSubagent: (sessionId) => subagents?.controls.stopSubagent(sessionId) ?? false,
    backgroundSubagent: (sessionId) => subagents?.controls.backgroundSubagent(sessionId) ?? false,
    async dispose() {
      try {
        await session.abort()
      } finally {
        try {
          await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
        } finally {
          try {
            events.flush()
          } finally {
            session.dispose()
          }
        }
      }
    }
  }
}
