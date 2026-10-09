import { InMemoryCredentialStore, type Message } from '@earendil-works/pi-ai'
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
import type { ModelCallPort, ModelCallSideChannel } from './ports'

export type AgentRuntimeModel = AiSdkModelSpec & {
  /** Pi provider id. Seeded assistant messages replay their signatures only when `provider`/`model` match. */
  provider: string
}

/** Pi settings the host may set. Retry is always off: retries belong to the host's AI SDK layer. */
export type AgentRuntimeSettings = Omit<NonNullable<Parameters<typeof SettingsManager.inMemory>[0]>, 'retry'>

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
  /** Conversation so far, oldest first; the session lives only in memory. */
  history?: Message[]
  tools?: ToolDefinition[]
  /** Pi built-in tools to enable, e.g. `read`, `bash`. None by default. */
  builtinTools?: string[]
  extensionFactories?: ExtensionFactory[]
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
  const { provider, ...modelSpec } = options.model

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

  const settingsManager = SettingsManager.inMemory({ ...options.settings, retry: { enabled: false } })
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
    extensionFactories: options.extensionFactories,
    // Overriding (even with undefined) keeps disk-discovered SYSTEM.md / APPEND_SYSTEM.md out.
    systemPromptOverride: () => options.systemPrompt,
    appendSystemPromptOverride: () => options.appendSystemPrompt ?? []
  })
  await resourceLoader.reload()

  const sessionManager = SessionManager.inMemory(cwd)
  for (const message of options.history ?? []) sessionManager.appendMessage(message)

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
  await session.bindExtensions({})

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
