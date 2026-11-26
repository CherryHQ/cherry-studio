import {
  Agent,
  Cursor,
  type AgentOptions,
  type McpServerConfig,
  type ModelSelection,
  type SDKAgent,
  type SDKModel,
  type SDKUserMessage,
  type SendOptions
} from '@cursor/sdk'

import type { CompactThread, InputDraft, SubmitInput } from '@cherrystudio/agent-runtime'

import { cursorLoginMethod, type CursorPermissionMode } from './cli'

export type { Run, SDKAgent, SDKUserMessage } from '@cursor/sdk'

export async function listCursorModels(apiKey?: string) {
  const models = await Cursor.models.list({ apiKey })
  return models.map((model) => {
    const effort = cursorEffort(model)
    return {
      id: model.id,
      name: model.displayName || model.id,
      ...(effort && { effort: { options: effort.options, defaultValue: effort.defaultValue } })
    }
  })
}

function cursorEffort(model: SDKModel, params?: ModelSelection['params']) {
  const parameter = ['effort', 'reasoning', 'reasoning_effort', 'thinking']
    .map((id) => model.parameters?.find((entry) => entry.id === id))
    .find((entry) => entry !== undefined)
  if (!parameter) return

  const otherParams = params?.filter(({ id }) => id !== parameter.id) ?? []
  const variants = model.variants?.filter((variant) =>
    otherParams.every(({ id, value }) => variant.params.some((param) => param.id === id && param.value === value))
  )
  const options = parameter.values
    .filter(
      ({ value }) =>
        !model.variants?.length ||
        variants?.some(({ params }) => params.some((param) => param.id === parameter.id && param.value === value))
    )
    .map(({ value, displayName }) => ({ value, name: displayName || value }))
  const defaultValue = variants?.find(({ isDefault }) => isDefault)?.params.find(({ id }) => id === parameter.id)?.value
  if (options.length) return { id: parameter.id, options, defaultValue, otherParams }
}

function bindEffort(models: readonly SDKModel[], selection: ModelSelection) {
  const model = models.find(({ id, aliases }) => id === selection.id || aliases?.includes(selection.id))
  const effort = model && cursorEffort(model, selection.params)
  if (!effort) return
  const { id, options, defaultValue, otherParams } = effort
  const activeValue = selection.params?.find((param) => param.id === id)?.value
  return {
    control: {
      id,
      modelId: selection.id,
      application: 'next-turn' as const,
      currentValue: activeValue ?? defaultValue ?? options[0].value,
      options
    },
    modelFor(value: string): ModelSelection {
      return { id: selection.id, params: [...otherParams, { id, value }] }
    }
  }
}

async function effortCatalog(apiKey?: string): Promise<SDKModel[]> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Cursor.models.list({ apiKey }).catch(() => []),
      new Promise<SDKModel[]>((resolve) => {
        timer = setTimeout(() => resolve([]), 3000)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
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

export async function openCursorSession(input: {
  apiKey?: string
  cwd: string
  model: string
  agentId?: string
  headless?: boolean
  browser?: Extract<McpServerConfig, { url: string }>
}) {
  const options: AgentOptions = {
    apiKey: input.apiKey,
    model: { id: input.model },
    mcpServers: input.browser ? { automation: input.browser } : {},
    local: { cwd: input.cwd, autoReview: true }
  }
  const [agent, models] = await Promise.all([
    input.agentId ? Agent.resume(input.agentId, options) : Agent.create(options),
    input.headless ? [] : effortCatalog(input.apiKey)
  ])
  return { agent, effort: bindEffort(models, agent.model ?? { id: input.model }) }
}

export function sendCursorTurn(
  agent: Pick<SDKAgent, 'send'>,
  prompt: SDKUserMessage,
  mode: CursorPermissionMode,
  host: {
    modelCallCompleted(modelCallId: string, inputTokens: number): void
    append(kind: 'text' | 'reasoning', text: string): void
    toolStarted(id: string, name: string, args: Record<string, unknown>): void
    toolCompleted(id: string, output: unknown, failed: boolean): void
  },
  model?: ModelSelection
) {
  const onDelta: NonNullable<SendOptions['onDelta']> = ({ update }) => {
    if (update.type === 'model-call-completed') {
      host.modelCallCompleted(update.modelCallId, update.usage.inputTokens)
      return
    }
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
  return agent.send(prompt, { mode: mode === 'plan' ? 'plan' : 'agent', onDelta, ...(model && { model }) })
}

export function bindCursorSteer(
  run: Run,
  onPlaced: (inputId: InputDraft['inputId']) => boolean
): SubmitInput | undefined {
  if (!run.steer) return
  return async ({ inputId, text }) => {
    const refused = () => ({
      status: 'rejected' as const,
      inputId,
      error: { operation: 'steer', code: 'not-delivered', message: 'Cursor did not accept the input' }
    })
    if (run.status !== 'running') return refused()
    try {
      const result = await run.steer?.(text)
      if (result === 'revert_to_followup') return refused()
      if (result === 'complete_delivered')
        return { status: 'acknowledged', inputId, facts: onPlaced(inputId) ? ['accepted', 'placed'] : ['accepted'] }
      if (result?.outcome === 'queued') return { status: 'acknowledged', inputId, facts: ['accepted', 'queued'] }
    } catch {
      // Async SDK failure does not establish whether the run consumed the steer.
    }
    return {
      status: 'unknown',
      inputId,
      error: { operation: 'steer', code: 'missing-receipt', message: 'Cursor did not confirm steer admission' }
    }
  }
}

export async function completeCursorCompaction(run: Run): ReturnType<CompactThread> {
  let summaryCompleted = false
  const observe = async () => {
    for await (const message of run.stream()) {
      if (message.type === 'summary' && message.run_id === run.id && message.status === 'completed')
        summaryCompleted = true
    }
  }
  const [terminal, summary] = await Promise.allSettled([run.wait(), observe()])
  if (terminal.status === 'rejected') throw terminal.reason
  const result = terminal.value
  if (result.status === 'finished' && summary.status === 'fulfilled' && summaryCompleted)
    return { status: 'confirmed', value: undefined }
  const cancelled = result.status === 'cancelled'
  return {
    status: result.status === 'finished' ? 'unknown' : 'rejected',
    error: {
      operation: 'compact',
      code: cancelled ? 'cancelled' : result.status === 'finished' ? 'missing-receipt' : 'failed',
      message: result.error?.message ?? 'Cursor did not complete compaction'
    }
  }
}
