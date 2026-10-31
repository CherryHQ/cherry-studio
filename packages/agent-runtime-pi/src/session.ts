import type { Api, Model } from '@earendil-works/pi-ai'
import {
  type AgentSession,
  createAgentSession,
  type CreateAgentSessionOptions,
  DefaultResourceLoader,
  type ExtensionFactory,
  type ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition
} from '@earendil-works/pi-coding-agent'

export type AgentRuntimeModel = Model<Api>

export type AgentRuntimeSettings = NonNullable<Parameters<typeof SettingsManager.inMemory>[0]>

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
  tools?: ToolDefinition[]
  /** Pi built-in tools to enable, e.g. `read`, `bash`. None by default. */
  builtinTools?: string[]
  extensionFactories?: ExtensionFactory[]
  settings?: AgentRuntimeSettings
  /** Native Pi thinking level (default `off`). */
  thinkingLevel?: CreateAgentSessionOptions['thinkingLevel']
}

export interface AgentRuntimeSession {
  session: AgentSession
  /** Aborts the running turn, lets extensions shut down, then disposes the session. */
  dispose(): Promise<void>
  prompt(text: string, options?: Parameters<AgentSession['prompt']>[1]): Promise<void>
  abort(): Promise<void>
}

/**
 * Builds a Pi agent session using the caller's native model runtime and native session storage.
 * Workspace context files and skills load only when the host opts in.
 * @param beforeStart Attach native observers before startup extensions can execute work.
 */
export async function createAgentRuntimeSession(
  options: AgentRuntimeSessionOptions,
  beforeStart?: (session: AgentSession) => void
): Promise<AgentRuntimeSession> {
  const { cwd, agentDir } = options
  const { modelRuntime, model } = options
  const settingsManager = SettingsManager.inMemory(options.settings ?? {})
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
    extensionFactories: options.extensionFactories ?? [],
    // Overriding (even with undefined) keeps disk-discovered SYSTEM.md / APPEND_SYSTEM.md out.
    systemPromptOverride: () => options.systemPrompt,
    appendSystemPromptOverride: () => options.appendSystemPrompt ?? []
  })
  await resourceLoader.reload()

  const sessionManager = options.sessionManager ?? SessionManager.inMemory(cwd)

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
  const owner: AgentRuntimeSession = {
    session,
    prompt: (text, promptOptions) => session.prompt(text, promptOptions),
    abort: () => session.abort(),
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
  try {
    beforeStart?.(session)
    await session.bindExtensions({})
    return owner
  } catch (cause) {
    await owner.dispose()
    throw cause
  }
}
