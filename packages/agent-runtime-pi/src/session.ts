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

import { type AgentRuntimeCompaction, compactionSummaryExtension } from './compaction'
import { type ToolOutputOffload, toolOutputOffloadExtension } from './offload'
import { recallExtension } from './recall'
import { type AgentRuntimeEvent, SessionEvents } from './sessionEvents'
import { subagentExtension, type SubagentPort } from './subagent'

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
  const { compaction } = options
  const summarize = compaction?.summarize
    ? (request: Parameters<NonNullable<AgentRuntimeCompaction['summarize']>>[0]) => {
        beforeModelRequest?.()
        return compaction.summarize!(request)
      }
    : undefined
  const extensionFactories = [
    ...(summarize ? [compactionSummaryExtension(summarize, (message) => (events.summaryFailure = message))] : []),
    ...(options.recall ? [recallExtension(() => sessionManager.getBranch())] : []),
    ...(options.subagents
      ? [
          subagentExtension({
            port: options.subagents,
            parentSession: sessionManager,
            createSession: ({ fork, beforeModelRequest: beforeChildRequest, ...overrides }) =>
              buildSession(
                {
                  ...options,
                  ...overrides,
                  subagents: fork ? options.subagents : undefined
                },
                beforeChildRequest
              )
          })
        ]
      : []),
    ...(options.extensionFactories ?? []),
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
    })
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
  if (beforeModelRequest) {
    const stream = session.agent.streamFunction
    session.agent.streamFunction = (model, context, options) => {
      beforeModelRequest()
      return stream(model, context, options)
    }
  }
  session.subscribe((event) => events.handle(event))
  await session.bindExtensions({})
  const baseTools = session.getActiveToolNames()
  events.setBaseTools(baseTools)
  if (events.activatedTools.length > 0) session.setActiveToolsByName([...baseTools, ...events.activatedTools])
  events.flush()

  return {
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
