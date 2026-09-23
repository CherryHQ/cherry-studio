import { AsyncLocalStorage } from 'node:async_hooks'

import {
  type CacheMode,
  type CallToolRequest,
  type CallToolResult,
  Client,
  CLIENT_CAPABILITIES_META_KEY,
  type ClientOptions,
  type ConnectOptions,
  type CreateMessageRequestParamsBase,
  type GetPromptRequest,
  type GetPromptResult,
  LOG_LEVEL_META_KEY,
  isJSONRPCRequest,
  isJSONRPCResponse,
  isInputRequiredResult,
  type Prompt,
  type ReadResourceRequest,
  type ReadResourceResult,
  type Resource,
  type Tool,
  type Transport
} from '@modelcontextprotocol/client'
import { withInputRequired } from '@modelcontextprotocol/client'
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/client/validators/cf-worker'
import { GetPromptResultSchema, ReadResourceResultSchema } from '@modelcontextprotocol/core'

import type {
  McpCallToolOptions,
  McpConnection,
  McpConnectionEvents,
  McpInteractionContext,
  McpRequestOptions
} from './McpConnection'
import type { McpForwardMethod, McpForwardOptions, McpForwardResult } from './McpConnection'

const INTERACTION_TIMEOUT_MS = 10 * 60 * 1000
const HEALTH_CHECK_TIMEOUT_MS = 5_000

interface ActiveInteraction {
  context: McpInteractionContext
  signal: AbortSignal
}

function requireInteractionContext(active: ActiveInteraction | undefined, capability: string): ActiveInteraction {
  if (!active) {
    throw new Error(`MCP ${capability} rejected: no active window/topic interaction context`)
  }
  if (active.signal.aborted) {
    throw active.signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
  }
  return active
}

/**
 * Shared v2 client implementation used by both external and in-process
 * adapters. It is intentionally kept inside the connections directory so
 * Runtime consumers only see the client-instance-neutral McpConnection interface.
 */
export class ClientMcpConnection implements McpConnection {
  private readonly client: Client
  private readonly interactionStorage = new AsyncLocalStorage<ActiveInteraction>()
  private readonly toolDefinitions = new Map<string, Tool>()
  private readonly closeHooks: Array<() => Promise<void>> = []
  private readonly activeRequests = new Map<ActiveInteraction, AbortController>()
  private closePromise: Promise<void> | undefined

  constructor(
    clientInfo: { name: string; version: string },
    options: Omit<ClientOptions, 'listChanged' | 'inputRequired'>,
    events: McpConnectionEvents
  ) {
    this.client = new Client(clientInfo, {
      ...options,
      inputRequired: { autoFulfill: true, maxRounds: 10 },
      listChanged: {
        tools: {
          onChanged: (error, tools) => {
            if (tools) this.rememberTools(tools)
            events.toolsChanged(error, tools)
          }
        },
        prompts: {
          onChanged: (error, prompts) => events.promptsChanged(error, prompts)
        },
        resources: {
          onChanged: (error, resources) => events.resourcesChanged(error, resources)
        }
      }
    })

    this.client.setNotificationHandler('notifications/resources/updated', async () => {
      events.resourceUpdated()
    })
    this.client.setNotificationHandler('notifications/message', async (notification) => {
      events.log(notification.params.level, notification.params.logger, notification.params.data)
    })

    this.client.setRequestHandler('elicitation/create', async (request, ctx) => {
      const active = requireInteractionContext(this.interactionStorage.getStore(), 'elicitation')
      if (!active.context.requestElicitation) {
        throw new Error('MCP elicitation rejected: no authorization host is available')
      }
      return active.context.requestElicitation(
        request,
        AbortSignal.any([active.signal, ctx.mcpReq.signal, AbortSignal.timeout(INTERACTION_TIMEOUT_MS)])
      )
    })

    this.client.setRequestHandler('sampling/createMessage', async (request, ctx) => {
      const active = requireInteractionContext(this.interactionStorage.getStore(), 'sampling')
      if (!active.context.model || !active.context.sample) {
        throw new Error('MCP sampling rejected: no model or sampling host is available')
      }
      const withoutTools: CreateMessageRequestParamsBase = { ...request.params }
      Reflect.deleteProperty(withoutTools, 'tools')
      Reflect.deleteProperty(withoutTools, 'toolChoice')
      return active.context.sample(
        withoutTools,
        AbortSignal.any([active.signal, ctx.mcpReq.signal, AbortSignal.timeout(INTERACTION_TIMEOUT_MS)])
      )
    })

    this.client.setRequestHandler('roots/list', async (_request, ctx) => {
      const active = requireInteractionContext(this.interactionStorage.getStore(), 'roots')
      if (!active.context.roots || !active.context.requestRoots) {
        throw new Error('MCP roots rejected: no precomputed workspace allow-list is available')
      }
      const signal = AbortSignal.any([active.signal, ctx.mcpReq.signal, AbortSignal.timeout(INTERACTION_TIMEOUT_MS)])
      if (!(await active.context.requestRoots(active.context.roots, signal))) {
        throw new Error('MCP roots request was declined')
      }
      return { roots: active.context.roots.map((root) => ({ ...root })) }
    })
  }

  public async connect(transport: Transport, options?: ConnectOptions): Promise<void> {
    await this.client.connect(transport, options)
    const pending = new Map<string | number, { active: ActiveInteraction; cleanup: () => void }>()
    const send = transport.send.bind(transport)
    const onmessage = transport.onmessage
    transport.send = async (message, sendOptions) => {
      const active = this.interactionStorage.getStore()
      if (active && isJSONRPCRequest(message)) {
        const cleanup = () => {
          pending.delete(message.id)
          active.signal.removeEventListener('abort', cleanup)
        }
        pending.set(message.id, { active, cleanup })
        active.signal.addEventListener('abort', cleanup, { once: true })
        try {
          await send(message, sendOptions)
        } catch (error) {
          cleanup()
          throw error
        }
      } else {
        await send(message, sendOptions)
      }
    }
    transport.onmessage = (message, extra) => {
      const request = isJSONRPCResponse(message) && message.id !== undefined ? pending.get(message.id) : undefined
      if (!request) {
        if (isJSONRPCRequest(message) && this.era === 'legacy' && this.activeRequests.size === 1) {
          const active = this.activeRequests.keys().next().value!
          return this.interactionStorage.run(active, () => onmessage?.(message, extra))
        }
        return onmessage?.(message, extra)
      }
      request.cleanup()
      // Stdio delivers responses from its connect-time listener, outside the caller's async context.
      this.interactionStorage.run(request.active, () => onmessage?.(message, extra))
    }
    this.addCloseHook(async () => {
      for (const request of pending.values()) request.cleanup()
    })
  }

  private async withRequestContext<T>(
    options: McpRequestOptions | undefined,
    run: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const lifetime = new AbortController()
    const signal = AbortSignal.any([
      lifetime.signal,
      ...(options ? [options.signal] : []),
      AbortSignal.timeout(options?.maxTotalTimeoutMs ?? options?.timeoutMs ?? 60_000)
    ])
    const active = { context: options?.interactionContext ?? {}, signal }
    this.activeRequests.set(active, lifetime)
    try {
      return await this.interactionStorage.run(active, () => run(signal))
    } finally {
      this.activeRequests.delete(active)
      lifetime.abort()
    }
  }

  public addCloseHook(hook: () => Promise<void>): void {
    this.closeHooks.push(hook)
  }

  public getInteractionContext(): McpInteractionContext | undefined {
    return this.interactionStorage.getStore()?.context
  }

  public get era() {
    const era = this.client.getProtocolEra()
    if (!era) throw new Error('MCP client is not connected')
    return era
  }

  public get serverVersion(): string | null {
    return this.client.getServerVersion()?.version ?? null
  }

  public get serverCapabilities() {
    return this.client.getServerCapabilities()
  }

  private rememberTools(tools: Tool[]): void {
    this.toolDefinitions.clear()
    for (const tool of tools) this.toolDefinitions.set(tool.name, tool)
  }

  private paramsWithLogLevel<T extends { _meta?: Record<string, unknown> }>(params: T): T {
    if (this.era !== 'modern') return params
    const context = this.interactionStorage.getStore()?.context
    return {
      ...params,
      _meta: {
        ...(typeof params._meta === 'object' && params._meta !== null ? params._meta : {}),
        [LOG_LEVEL_META_KEY]: 'info',
        [CLIENT_CAPABILITIES_META_KEY]: {
          ...(context?.requestElicitation ? { elicitation: { form: {}, url: {} } } : {}),
          ...(context?.model && context.sample ? { sampling: {} } : {}),
          ...(context?.roots && context.requestRoots ? { roots: {} } : {})
        }
      }
    }
  }

  public async listTools(cacheMode: CacheMode = 'use', signal?: AbortSignal): Promise<Tool[]> {
    const { tools } = await this.client.listTools(this.paramsWithLogLevel({}), { cacheMode, signal })
    this.rememberTools(tools)
    return tools
  }

  public async callTool(name: string, args: unknown, options: McpCallToolOptions): Promise<CallToolResult> {
    return this.withRequestContext(options, async (signal) => {
      let toolDefinition = this.toolDefinitions.get(name)
      if (!toolDefinition) {
        await this.listTools('use', signal)
        toolDefinition = this.toolDefinitions.get(name)
      }

      const params: CallToolRequest['params'] = {
        name,
        arguments: (args ?? {}) as Record<string, unknown>
      }
      return this.client.callTool(this.paramsWithLogLevel(params), {
        signal,
        timeout: options.timeoutMs,
        resetTimeoutOnProgress: options.resetTimeoutOnProgress,
        maxTotalTimeout: options.maxTotalTimeoutMs,
        toolDefinition,
        onprogress: options.onProgress
          ? (progress) => options.onProgress?.(progress.progress, progress.total)
          : undefined
      })
    })
  }

  public async listPrompts(cacheMode: CacheMode = 'use'): Promise<Prompt[]> {
    // The SDK reads the negotiated server capabilities and returns [] when prompts are not advertised.
    const { prompts } = await this.client.listPrompts(this.paramsWithLogLevel({}), { cacheMode })
    return prompts
  }

  public async forwardRequest(
    method: McpForwardMethod,
    params: Record<string, unknown>,
    options: McpForwardOptions
  ): Promise<McpForwardResult> {
    return this.withRequestContext(options, async (signal) => {
      const forwarded = {
        ...params,
        _meta: { ...this.paramsWithLogLevel({ _meta: {} })._meta, [CLIENT_CAPABILITIES_META_KEY]: options.capabilities }
      }
      const requestOptions = {
        signal,
        timeout: options.timeoutMs,
        resetTimeoutOnProgress: options.resetTimeoutOnProgress,
        maxTotalTimeout: options.maxTotalTimeoutMs,
        allowInputRequired: true,
        onprogress: options.onProgress
          ? (progress: { progress: number; total?: number }) => options.onProgress?.(progress.progress, progress.total)
          : undefined
      }
      if (method === 'prompts/get')
        return this.client.request(
          { method, params: forwarded },
          withInputRequired(GetPromptResultSchema),
          requestOptions
        )
      if (method === 'resources/read')
        return this.client.request(
          { method, params: forwarded },
          withInputRequired(ReadResourceResultSchema),
          requestOptions
        )
      const name = String(params.name)
      if (!this.toolDefinitions.has(name)) await this.listTools('use', signal)
      const definition = this.toolDefinitions.get(name)
      const validate =
        definition?.outputSchema !== undefined
          ? new CfWorkerJsonSchemaValidator().getValidator(definition.outputSchema)
          : undefined
      // callTool's complete-result validator cannot accept input_required; validate only the final result here.
      const result = await this.client.callTool(
        { ...forwarded, name },
        {
          ...requestOptions,
          toolDefinition: definition ? { ...definition, outputSchema: undefined } : undefined
        }
      )
      if (!isInputRequiredResult(result) && validate && !result.isError) {
        if (result.structuredContent === undefined)
          throw new Error(`Tool ${name} did not return its declared structured content`)
        const checked = validate(result.structuredContent)
        if (!checked.valid) throw new Error(checked.errorMessage)
      }
      return result
    })
  }

  public async getPrompt(
    name: string,
    args?: Record<string, string>,
    options?: McpRequestOptions
  ): Promise<GetPromptResult> {
    const params: GetPromptRequest['params'] = { name, arguments: args }
    return this.withRequestContext(options, (signal) =>
      this.client.getPrompt(this.paramsWithLogLevel(params), {
        signal,
        timeout: options?.timeoutMs,
        resetTimeoutOnProgress: options?.resetTimeoutOnProgress,
        maxTotalTimeout: options?.maxTotalTimeoutMs
      })
    )
  }

  public async listResources(cacheMode: CacheMode = 'use'): Promise<Resource[]> {
    // The SDK reads the negotiated server capabilities and returns [] when resources are not advertised.
    const { resources } = await this.client.listResources(this.paramsWithLogLevel({}), { cacheMode })
    return resources
  }

  public async readResource(
    uri: string,
    cacheMode: CacheMode = 'use',
    options?: McpRequestOptions
  ): Promise<ReadResourceResult> {
    const params: ReadResourceRequest['params'] = { uri }
    return this.withRequestContext(options, (signal) =>
      this.client.readResource(this.paramsWithLogLevel(params), {
        cacheMode,
        signal,
        timeout: options?.timeoutMs,
        resetTimeoutOnProgress: options?.resetTimeoutOnProgress,
        maxTotalTimeout: options?.maxTotalTimeoutMs
      })
    )
  }

  public async health(): Promise<void> {
    if (this.era === 'modern') {
      await this.client.discover({ timeout: HEALTH_CHECK_TIMEOUT_MS })
      return
    }
    await this.client.ping({ timeout: HEALTH_CHECK_TIMEOUT_MS })
  }

  private async closeOnce(): Promise<void> {
    for (const lifetime of this.activeRequests.values()) lifetime.abort()
    let firstError: unknown
    try {
      await this.client.close()
    } catch (error) {
      firstError = error
    }
    for (const hook of this.closeHooks) {
      try {
        await hook()
      } catch (error) {
        firstError ??= error
      }
    }
    this.toolDefinitions.clear()
    if (firstError) throw firstError
  }

  public close(): Promise<void> {
    this.closePromise ??= this.closeOnce()
    return this.closePromise
  }
}
