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
import { type AgentRuntimeEvent, SessionEvents } from './sessionEvents'

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
  tools?: ToolDefinition[]
  /** Pi built-in tools to enable, e.g. `read`, `bash`. None by default. */
  builtinTools?: string[]
  /** Tools unavailable to this session, including extension and restored tool loadouts. */
  excludeTools?: string[]
  extensionFactories?: ExtensionFactory[]
  settings?: AgentRuntimeSettings
  /** Native Pi thinking level (default `off`). */
  thinkingLevel?: CreateAgentSessionOptions['thinkingLevel']
}

export interface AgentRuntimeSession {
  session: AgentSession
  /** The configured summary callback, for adapter wiring validation. */
  readonly compactionSummarizer?: AgentRuntimeCompaction['summarize']
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
  /** Aborts the active native run; behavior rules own user-stop attribution. */
  abort(): Promise<void>
}

/**
 * Builds a Pi agent session using the caller's native model runtime and native session storage.
 * Workspace context files and skills load only when the host opts in.
 */
export async function createAgentRuntimeSession(
  options: AgentRuntimeSessionOptions,
  beforeStart?: (session: AgentSession) => void
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
  const extensionFactories = [
    // First, so the watch covers every other extension's agent_settled handler.
    settleWatch,
    ...(options.extensionFactories ?? []),
    ...(summarize ? [compactionSummaryExtension(summarize, (message) => (events.summaryFailure = message))] : [])
  ]
  const settingsManager = SettingsManager.inMemory(
    {
      ...options.settings,
      ...(compaction && {
        compaction: {
          enabled: compaction.enabled ?? true,
          reserveTokens: compaction.reserveTokens,
          keepRecentTokens: compaction.keepRecentTokens
        }
      })
    },
    { projectTrusted: options.contextFiles === true }
  )
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
    customTools: options.tools ?? [],
    excludeTools: options.excludeTools
  })
  session.subscribe((event) => {
    events.handle(event)
    if (event.type !== 'agent_settled') return
    settling?.end()
    settling = undefined
  })

  const held = async (run: () => Promise<unknown>) => {
    if (settling) {
      await settling.over
      // A run Pi deferred during the settle goes first, preserving native ordering.
      await session.waitForIdle()
    }
    await run()
  }
  const owner: AgentRuntimeSession = {
    session,
    compactionSummarizer: compaction?.summarize,
    prompt: (text, promptOptions) => held(() => session.prompt(text, promptOptions)),
    compact: (customInstructions) => held(() => session.compact(customInstructions)),
    abort: () => session.abort(),
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
  try {
    beforeStart?.(session)
    await session.bindExtensions({})
    const baseTools = session.getActiveToolNames()
    events.setBaseTools(baseTools)
    if (events.activatedTools.length > 0) session.setActiveToolsByName([...baseTools, ...events.activatedTools])
    events.flush()
    return owner
  } catch (cause) {
    await owner.dispose()
    throw cause
  }
}
