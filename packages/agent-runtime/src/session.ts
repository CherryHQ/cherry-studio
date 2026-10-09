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
import type { TranscriptEntry } from './transcript'
import { type AgentRuntimeEvent, TranscriptTap } from './transcriptTap'

export type AgentRuntimeModel = AiSdkModelSpec & {
  /** Pi provider id. */
  provider: string
  /**
   * Stable host identity of the model (e.g. Cherry's unique model id), stored on assistant entries.
   * A stored reply replays its reasoning and signatures only to a model with the same key.
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
  settings?: AgentRuntimeSettings
  /** Pi's own thinking level (default `off`). It does not reach the model request. */
  thinkingLevel?: CreateAgentSessionOptions['thinkingLevel']
}

export interface AgentRuntimeSession {
  session: AgentSession
  /** Aborts the running turn, lets extensions shut down, then disposes the session. */
  dispose(): Promise<void>
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
      models: [modelSpec]
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

  const { compaction } = options
  const extensionFactories = [
    ...(compaction?.summarize
      ? [compactionSummaryExtension(compaction.summarize, (message) => (tap.summaryFailure = message))]
      : []),
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
  session.subscribe((event) => tap.handle(event))
  // State entries are in the session before extensions bind, so `session_start` sees them.
  await session.bindExtensions({})
  const baseTools = session.getActiveToolNames()
  tap.setBaseTools(baseTools)
  if (rebuilt.activatedTools.length > 0) session.setActiveToolsByName([...baseTools, ...rebuilt.activatedTools])

  return {
    session,
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
