import {
  Agent,
  Cursor,
  type AgentOptions,
  type McpServerConfig,
  type SDKAgent,
  type SDKUserMessage,
  type SendOptions
} from '@cursor/sdk'

import { cursorLoginMethod, type CursorPermissionMode } from './cli'

export type { Run, SDKAgent, SDKUserMessage } from '@cursor/sdk'

export async function listCursorModels(apiKey?: string) {
  const models = await Cursor.models.list({ apiKey })
  return models.map(({ id, displayName }) => ({ id, name: displayName || id }))
}

export function cursorLogin(methodId: string, signal: AbortSignal, openBrowser: (url: string) => Promise<void>) {
  if (methodId !== cursorLoginMethod.id) throw new Error('Unknown Cursor authentication method')
  return Cursor.auth.login({ signal, openBrowser }).then(() => undefined)
}

export async function cursorAuthStatus(apiKey?: string) {
  if (apiKey) {
    await Cursor.me({ apiKey })
    return 'signed-in' as const
  }
  return (await Cursor.auth.status()).status === 'logged-in' ? ('signed-in' as const) : ('signed-out' as const)
}

export function openCursorSession(input: {
  apiKey?: string
  cwd: string
  model: string
  agentId?: string
  browser?: Extract<McpServerConfig, { url: string }>
}) {
  const options: AgentOptions = {
    apiKey: input.apiKey,
    model: { id: input.model },
    mcpServers: input.browser ? { automation: input.browser } : {},
    local: { cwd: input.cwd, autoReview: true }
  }
  return input.agentId ? Agent.resume(input.agentId, options) : Agent.create(options)
}

export function sendCursorTurn(
  agent: Pick<SDKAgent, 'send'>,
  prompt: SDKUserMessage,
  mode: CursorPermissionMode,
  host: {
    append(kind: 'text' | 'reasoning', text: string): void
    toolStarted(id: string, name: string, args: Record<string, unknown>): void
    toolCompleted(id: string, output: unknown, failed: boolean): void
  }
) {
  const onDelta: NonNullable<SendOptions['onDelta']> = ({ update }) => {
    if (update.type === 'text-delta') host.append('text', update.text)
    if (update.type === 'thinking-delta') host.append('reasoning', update.text)
    if (update.type !== 'tool-call-started' && update.type !== 'tool-call-completed') return
    const tool = update.toolCall
    if (tool.type === 'mcp') {
      const { providerIdentifier, toolName, args } = tool.args
      const name = providerIdentifier && toolName ? `mcp__${providerIdentifier}__${toolName}` : (toolName ?? 'MCP')
      host.toolStarted(update.callId, name, args ?? {})
    } else {
      host.toolStarted(update.callId, tool.type.charAt(0).toUpperCase() + tool.type.slice(1), tool.args)
    }
    if (update.type === 'tool-call-completed' && tool.result) {
      const result = tool.result
      host.toolCompleted(
        update.callId,
        result.status === 'success' ? result.value : result.error,
        result.status === 'error' || ('isError' in result.value && result.value.isError === true)
      )
    }
  }
  return agent.send(prompt, { mode: mode === 'plan' ? 'plan' : 'agent', onDelta })
}
