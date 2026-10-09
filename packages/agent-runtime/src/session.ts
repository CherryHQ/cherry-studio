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
  /** Working directory for Pi's built-in tools and the `<cwd>` prompt section. Nothing is loaded from it. */
  cwd: string
  /** Pi's agent directory. Nothing is loaded from it; it only keeps Pi off its `~/.pi/agent` default. */
  agentDir: string
  /** Replaces Pi's default prompt. Pi still appends a `<cwd>` section. */
  systemPrompt: string
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

/** Builds a Pi agent session entirely in memory: no credentials, settings, resources or session files from disk. */
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
    noContextFiles: true,
    extensionFactories: options.extensionFactories,
    systemPromptOverride: () => options.systemPrompt,
    appendSystemPromptOverride: () => []
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
