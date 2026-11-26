import {
  Agent,
  Cursor,
  emptyFs,
  type AgentOptions,
  type McpServerConfig,
  type SDKAgent,
  type SDKCustomTool,
  type SDKUserMessage,
  type SendOptions
} from '@cursor/sdk'

export type { Run, SDKAgent, SDKCustomTool, SDKUserMessage } from '@cursor/sdk'

export async function listCursorModels(apiKey?: string) {
  const models = await Cursor.models.list({ apiKey })
  return models.map(({ id, displayName }) => ({ id, name: displayName || id }))
}

export function cursorLogin(signal: AbortSignal, openBrowser: (url: string) => Promise<void>) {
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
    tools: ['mcp', 'read', 'grep'],
    mcpServers: input.browser ? { automation: input.browser } : {},
    local: { cwd: input.cwd, fs: emptyFs(), settingSources: [] }
  }
  return input.agentId ? Agent.resume(input.agentId, options) : Agent.create(options)
}

export function sendCursorTurn(
  agent: SDKAgent,
  prompt: SDKUserMessage,
  mode: 'plan' | 'agent',
  customTools: Record<string, SDKCustomTool>,
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
    if (tool.type === 'read' || tool.type === 'grep') {
      host.toolStarted(update.callId, tool.type === 'read' ? 'Read' : 'Grep', tool.args)
    } else if (tool.type === 'mcp' && tool.args.providerIdentifier === 'automation' && tool.args.toolName) {
      host.toolStarted(update.callId, `mcp__automation__${tool.args.toolName}`, tool.args.args ?? {})
    } else {
      return
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
  return agent.send(prompt, { mode, onDelta, local: { customTools } })
}
