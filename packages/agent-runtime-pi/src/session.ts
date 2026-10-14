import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import {
  type AgentSession,
  createAgentSession,
  type CreateAgentSessionOptions,
  DefaultResourceLoader,
  type ExtensionFactory,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition
} from '@earendil-works/pi-coding-agent'

import { type AiSdkModelSpec, createAiSdkProvider } from './aiSdkProvider'
import { type AgentRuntimeCompaction, compactionSummaryExtension } from './compaction'
import { type ToolOutputOffload, toolOutputOffloadExtension } from './offload'
import type { ModelCallPort, ModelCallSideChannel } from './ports'
import { rebuildSessionEntries } from './rebuild'
import { recallExtension } from './recall'
import { createSubagentExtension, type SubagentPort } from './subagent'
import type { TranscriptEntry } from './transcript'
import { type AgentRuntimeEvent, TranscriptTap } from './transcriptTap'

export type AgentRuntimeModel = AiSdkModelSpec & {
  /** Pi provider id. */
  provider: string
  /**
   * Stable host identity of the model (e.g. Cherry's unique model id), stored on assistant entries.
   * A stored reply replays its reasoning as reasoning, with signatures, only to a model with the same
   * key; other models get that reasoning as plain text.
   */
  key: string
}

/**
 * Pi settings the host may set. Retry is always off: retries belong to the host's AI SDK layer.
 * Compaction has its own option.
 */
export type AgentRuntimeSettings = Omit<
  NonNullable<Parameters<typeof SettingsManager.inMemory>[0]>,
  'retry' | 'compaction'
>

export interface AgentRuntimeSessionOptions<TRequestOptions = undefined> {
  port: ModelCallPort<TRequestOptions>
  /** Forwarded on every model request; the host decides reasoning here, not through `thinkingLevel`. */
  requestOptions: TRequestOptions
  sideChannel?: ModelCallSideChannel
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
  /** Pi session id; keep it stable per host session, it is also the prompt-cache routing key. Random when omitted. */
  sessionId?: string
  /**
   * The host session so far: the full active path, oldest first, uncompacted. The session lives only
   * in memory. An invalid transcript throws a `TranscriptError` before anything is created.
   */
  transcript?: readonly TranscriptEntry[]
  /** New transcript entries and turn events, in order. Runs inline with Pi's events and must not throw. */
  onEvent?: (event: AgentRuntimeEvent) => void
  tools?: ToolDefinition[]
  /** Pi built-in tools to enable, e.g. `read`, `bash`. None by default. */
  builtinTools?: string[]
  extensionFactories?: ExtensionFactory[]
  /** Pi's defaults (reserve 16384, keep 20000, its own summarizer) when omitted. */
  compaction?: AgentRuntimeCompaction
  /** Saves oversized tool outputs through the host and sends a marker instead. Off when omitted. */
  offload?: ToolOutputOffload
  /** Registers `vcc_recall` over this session's transcript. */
  recall?: boolean
  /** Registers `subagent`; the host configures each subagent through this port. Off when omitted. */
  subagents?: SubagentPort
  settings?: AgentRuntimeSettings
  /** Pi's own thinking level (default `off`). It does not reach the model request. */
  thinkingLevel?: CreateAgentSessionOptions['thinkingLevel']
}

export interface AgentRuntimeSession {
  session: AgentSession
  /** Aborts the running turn, lets extensions shut down, then disposes the session. */
  dispose(): Promise<void>
  /**
   * `session.prompt`, for every user turn the host starts: while it prepares, Pi reports the session
   * idle, and a background result must not start a run then. Called while a run settles (from
   * `onEvent`'s `turn-complete`), it runs once that settle and any run Pi started meanwhile are over,
   * and resolves or rejects as that prompt does.
   */
  prompt(text: string, options?: Parameters<AgentSession['prompt']>[1]): Promise<void>
  /** `session.compact`, for every manual compaction the host starts, for the same reason. */
  compact(customInstructions?: string): Promise<void>
  /** The user stops a background subagent (the host's stop button); false when it is not running. */
  stopSubagent(sessionId: string): boolean
  /**
   * The user moves a running foreground subagent to the background: its call returns at once and
   * the same run goes on, ending in a notification. False for any other subagent.
   */
  backgroundSubagent(sessionId: string): boolean
}

/** The port and host summarizer of `options`, each request first passing `before` (a subagent's request cap). */
function gateModelRequests<TRequestOptions>(
  options: AgentRuntimeSessionOptions<TRequestOptions>,
  before: () => void
): Pick<AgentRuntimeSessionOptions<TRequestOptions>, 'port' | 'compaction'> {
  const { port, compaction } = options
  const summarize = compaction?.summarize
  return {
    port: {
      streamText(request) {
        before()
        return port.streamText(request)
      }
    },
    compaction: summarize
      ? {
          ...compaction,
          summarize(request) {
            before()
            return summarize(request)
          }
        }
      : compaction
  }
}

/**
 * Builds a Pi agent session in memory: no credentials, settings, extensions or session files from disk.
 * Workspace context files and skills load only when the host opts in.
 */
export async function createAgentRuntimeSession<TRequestOptions>(
  options: AgentRuntimeSessionOptions<TRequestOptions>
): Promise<AgentRuntimeSession> {
  const { cwd, agentDir } = options
  const { provider, key, ...modelSpec } = options.model
  const transcriptModel = { key, provider, id: modelSpec.id }
  const transcript = options.transcript ?? []
  const rebuilt = rebuildSessionEntries(transcript, transcriptModel)

  // Pi validates `{}` before `tool_call`, so only a schema that accepts it reaches the guard.
  const invalidToolCalls = new Map<string, string>()
  const invalidToolCallGuard: ExtensionFactory = (pi) => {
    pi.on('turn_start', () => invalidToolCalls.clear())
    pi.on('tool_call', (event) => {
      const reason = invalidToolCalls.get(event.toolCallId)
      return reason === undefined ? undefined : { block: true, reason }
    })
  }

  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  modelRuntime.registerProvider(
    provider,
    createAiSdkProvider({
      port: options.port,
      requestOptions: options.requestOptions,
      sideChannel: options.sideChannel,
      models: [modelSpec],
      onInvalidToolCall: (toolCallId, error) => invalidToolCalls.set(toolCallId, error)
    })
  )
  const model = modelRuntime.getModel(provider, modelSpec.id)
  if (!model) throw new Error(`Model ${provider}/${modelSpec.id} was not registered`)

  const sessionManager = SessionManager.inMemory(
    cwd,
    options.sessionId === undefined ? undefined : { id: options.sessionId },
    rebuilt.entries
  )
  const tap = new TranscriptTap(
    sessionManager,
    transcriptModel,
    { transcript, piEntryCount: rebuilt.entries.length, activatedTools: rebuilt.activatedTools },
    options.onEvent ?? (() => {})
  )

  // Pi defers a prompt made while it dispatches agent_settled and returns before it runs; `held` waits instead.
  let settling: { over: Promise<void>; end: () => void } | undefined
  const settleWatch: ExtensionFactory = (pi) => {
    pi.on('agent_settled', () => {
      let end!: () => void
      settling = { over: new Promise((resolve) => (end = resolve)), end }
    })
  }

  const { compaction } = options
  const subagents =
    options.subagents &&
    createSubagentExtension({
      port: options.subagents,
      // A fork keeps `subagent` so its tools match the parent's; a fresh subagent has none.
      createSession: ({ fork, beforeModelRequest, ...overrides }) =>
        createAgentRuntimeSession({
          ...options,
          ...overrides,
          ...gateModelRequests(options, beforeModelRequest),
          subagents: fork ? options.subagents : undefined
        }),
      parentTranscript: () => tap.entries(),
      parentModel: options.model,
      emit: (event) => options.onEvent?.(event),
      offload: options.offload
    })
  const extensionFactories = [
    // First, so the watch covers every other extension's agent_settled handler.
    settleWatch,
    // Before every host `tool_call` handler (an approval prompt), so none sees a call Pi will not run.
    invalidToolCallGuard,
    ...(compaction?.summarize
      ? [compactionSummaryExtension(compaction.summarize, (message) => (tap.summaryFailure = message))]
      : []),
    ...(options.recall ? [recallExtension(() => tap.entries())] : []),
    ...(subagents ? [subagents.extension] : []),
    ...(options.extensionFactories ?? []),
    // Last, so it sees what other `tool_result` handlers made of the output.
    ...(options.offload ? [toolOutputOffloadExtension(options.offload)] : [])
  ]
  const settingsManager = SettingsManager.inMemory({
    ...options.settings,
    ...(compaction && {
      compaction: {
        enabled: compaction.enabled ?? true,
        reserveTokens: compaction.reserveTokens,
        keepRecentTokens: compaction.keepRecentTokens
      }
    }),
    retry: { enabled: false }
  })
  const resourceLoader = new DefaultResourceLoader({
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
  session.subscribe((event) => {
    tap.handle(event)
    if (event.type !== 'agent_settled') return
    settling?.end()
    settling = undefined
  })
  // State entries are in the session before extensions bind, so `session_start` sees them.
  await session.bindExtensions({})
  const baseTools = session.getActiveToolNames()
  tap.setBaseTools(baseTools)
  if (rebuilt.activatedTools.length > 0) session.setActiveToolsByName([...baseTools, ...rebuilt.activatedTools])

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
    stopSubagent: (sessionId) => subagents?.controls.stopSubagent(sessionId) ?? false,
    backgroundSubagent: (sessionId) => subagents?.controls.backgroundSubagent(sessionId) ?? false,
    async dispose() {
      try {
        await session.abort()
      } finally {
        try {
          await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
        } finally {
          session.dispose()
        }
      }
    }
  }
}
