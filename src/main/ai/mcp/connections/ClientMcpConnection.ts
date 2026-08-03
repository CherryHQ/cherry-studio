import { AsyncLocalStorage } from 'node:async_hooks'

import {
  type CacheMode,
  type CallToolRequest,
  type CallToolResult,
  Client,
  type ClientOptions,
  type ConnectOptions,
  type CreateMessageRequestParamsBase,
  type GetPromptRequest,
  type GetPromptResult,
  LOG_LEVEL_META_KEY,
  type Prompt,
  type ReadResourceRequest,
  type ReadResourceResult,
  type Resource,
  type Tool,
  type Transport
} from '@modelcontextprotocol/client'

import type { McpCallToolOptions, McpConnection, McpConnectionEvents, McpInteractionContext } from './McpConnection'

const INTERACTION_TIMEOUT_MS = 10 * 60 * 1000

interface ActiveInteraction {
  context: McpInteractionContext
  signal: AbortSignal
}

function requireInteractionContext(active: ActiveInteraction | undefined, capability: string): ActiveInteraction {
  if (!active?.context.windowId || !active.context.topicId) {
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

    this.client.setRequestHandler('elicitation/create', async (request) => {
      const active = requireInteractionContext(this.interactionStorage.getStore(), 'elicitation')
      if (!active.context.requestElicitation) {
        throw new Error('MCP elicitation rejected: no authorization host is available')
      }
      return active.context.requestElicitation(
        request,
        AbortSignal.any([active.signal, AbortSignal.timeout(INTERACTION_TIMEOUT_MS)])
      )
    })

    this.client.setRequestHandler('sampling/createMessage', async (request) => {
      const active = requireInteractionContext(this.interactionStorage.getStore(), 'sampling')
      if (!active.context.model || !active.context.sample) {
        throw new Error('MCP sampling rejected: no model or sampling host is available')
      }
      const withoutTools: CreateMessageRequestParamsBase = { ...request.params }
      Reflect.deleteProperty(withoutTools, 'tools')
      Reflect.deleteProperty(withoutTools, 'toolChoice')
      return active.context.sample(
        withoutTools,
        AbortSignal.any([active.signal, AbortSignal.timeout(INTERACTION_TIMEOUT_MS)])
      )
    })

    this.client.setRequestHandler('roots/list', async () => {
      const active = requireInteractionContext(this.interactionStorage.getStore(), 'roots')
      if (!active.context.roots || !active.context.requestRoots) {
        throw new Error('MCP roots rejected: no precomputed workspace allow-list is available')
      }
      const signal = AbortSignal.any([active.signal, AbortSignal.timeout(INTERACTION_TIMEOUT_MS)])
      if (!(await active.context.requestRoots(active.context.roots, signal))) {
        throw new Error('MCP roots request was declined')
      }
      return { roots: active.context.roots.map((root) => ({ ...root })) }
    })
  }

  public async connect(transport: Transport, options?: ConnectOptions): Promise<void> {
    await this.client.connect(transport, options)
  }

  public addCloseHook(hook: () => Promise<void>): void {
    this.closeHooks.push(hook)
  }

  public get era() {
    const era = this.client.getProtocolEra()
    if (!era) throw new Error('MCP client is not connected')
    return era
  }

  public get serverVersion(): string | null {
    return this.client.getServerVersion()?.version ?? null
  }

  private rememberTools(tools: Tool[]): void {
    this.toolDefinitions.clear()
    for (const tool of tools) this.toolDefinitions.set(tool.name, tool)
  }

  private paramsWithLogLevel<T extends { _meta?: Record<string, unknown> }>(params: T): T {
    if (this.era !== 'modern') return params
    return {
      ...params,
      _meta: {
        ...(typeof params._meta === 'object' && params._meta !== null ? params._meta : {}),
        [LOG_LEVEL_META_KEY]: 'info'
      }
    }
  }

  public async listTools(cacheMode: CacheMode = 'use'): Promise<Tool[]> {
    const { tools } = await this.client.listTools(this.paramsWithLogLevel({}), { cacheMode })
    this.rememberTools(tools)
    return tools
  }

  public async callTool(name: string, args: unknown, options: McpCallToolOptions): Promise<CallToolResult> {
    let toolDefinition = this.toolDefinitions.get(name)
    if (!toolDefinition) {
      await this.listTools()
      toolDefinition = this.toolDefinitions.get(name)
    }

    const params: CallToolRequest['params'] = {
      name,
      arguments: (args ?? {}) as Record<string, unknown>
    }
    const run = () =>
      this.client.callTool(this.paramsWithLogLevel(params), {
        signal: options.signal,
        timeout: options.timeoutMs,
        resetTimeoutOnProgress: options.resetTimeoutOnProgress,
        maxTotalTimeout: options.maxTotalTimeoutMs,
        toolDefinition,
        onprogress: options.onProgress
          ? (progress) => options.onProgress?.(progress.progress, progress.total)
          : undefined
      })

    const result = options.interactionContext
      ? await this.interactionStorage.run({ context: options.interactionContext, signal: options.signal }, run)
      : await run()
    return result
  }

  public async listPrompts(cacheMode: CacheMode = 'use'): Promise<Prompt[]> {
    // The SDK reads the negotiated server capabilities and returns [] when prompts are not advertised.
    const { prompts } = await this.client.listPrompts(this.paramsWithLogLevel({}), { cacheMode })
    return prompts
  }

  public async getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    const params: GetPromptRequest['params'] = { name, arguments: args }
    return this.client.getPrompt(this.paramsWithLogLevel(params))
  }

  public async listResources(cacheMode: CacheMode = 'use'): Promise<Resource[]> {
    // The SDK reads the negotiated server capabilities and returns [] when resources are not advertised.
    const { resources } = await this.client.listResources(this.paramsWithLogLevel({}), { cacheMode })
    return resources
  }

  public async readResource(uri: string, cacheMode: CacheMode = 'use'): Promise<ReadResourceResult> {
    const params: ReadResourceRequest['params'] = { uri }
    return this.client.readResource(this.paramsWithLogLevel(params), { cacheMode })
  }

  public async health(): Promise<void> {
    if (this.era === 'modern') {
      await this.client.discover()
      return
    }
    await this.client.ping()
  }

  private async closeOnce(): Promise<void> {
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
