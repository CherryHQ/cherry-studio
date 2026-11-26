import {
  client,
  CreateElicitationRequest,
  methods,
  PROTOCOL_VERSION,
  RequestError,
  type ClientRequestContext,
  type InitializeRequest,
  type InitializeResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type ResumeSessionRequest,
  type SessionNotification,
  type Stream
} from '@agentclientprotocol/sdk'
import * as z from 'zod'

import type { RuntimeLoginHost } from '@cherrystudio/agent-runtime'

import type {
  AcpAccountReader,
  AcpHarnessAdapter,
  AcpNativeTurn,
  AcpModelCatalogReader,
  AcpSubscriptionUsageReader
} from './harness'
import { deadline } from './result'
import type { AcpClientCallbacks, AcpSessionConfiguration } from './types'
import { readPromptUsage } from './usage'

type WireMessage = Stream['readable'] extends ReadableStream<infer Message> ? Message : never

const legacyModelsSchema = z.object({
  currentModelId: z.string(),
  availableModels: z.array(
    z.object({
      modelId: z.string(),
      name: z.string(),
      description: z.string().nullish().catch(undefined),
      _meta: z.record(z.string(), z.unknown()).nullish().catch(undefined)
    })
  )
})

export interface AcpClientOptions {
  clientInfo: NonNullable<InitializeRequest['clientInfo']>
  sessionCapabilities?: NonNullable<InitializeRequest['clientCapabilities']>['session']
  /** Reject unsolicited host writes and terminal creation when the host advertises read-only access. */
  denyMutation?(sessionId: string): Error
  callbacks: AcpClientCallbacks
  confirmLoginInBrowser?: RuntimeLoginHost['confirmBrowser']
  update(notification: SessionNotification): void
  nativeTurn?(event: AcpNativeTurn): void
  harness?: AcpHarnessAdapter
}

/** One reader for the supplied stream. Live notifications and prompt responses are delivered without retaining history. */
export function connectAcpClient(stream: Stream, options: AcpClientOptions) {
  const { callbacks, confirmLoginInBrowser, harness, denyMutation } = options
  let authenticating = false
  const orderedNotifications = new Map<string, (params: unknown) => void>()
  let pendingUpdates = 0
  let flushedUpdates: PromiseWithResolvers<void> | undefined
  const app = client({ name: options.clientInfo.name })
    .onNotification(methods.client.session.update, ({ params }) => {
      try {
        options.update(params)
      } finally {
        if (orderedNotifications.size && --pendingUpdates === 0) {
          flushedUpdates?.resolve()
          flushedUpdates = undefined
        }
      }
    })
    .onRequest(
      methods.client.session.requestPermission,
      ({ params, signal }) => callbacks.permission?.(params, { signal }) ?? { outcome: { outcome: 'cancelled' } }
    )

  function callback<P, R>(run: (params: P, context: { signal: AbortSignal }) => Promise<R>) {
    return ({ params, signal }: ClientRequestContext<P>) => run(params, { signal })
  }
  function mutation<P extends { sessionId: string }, R>(
    run: (params: P, context: { signal: AbortSignal }) => Promise<R>
  ) {
    return ({ params, signal }: ClientRequestContext<P>) => {
      if (denyMutation) throw denyMutation(params.sessionId)
      return run(params, { signal })
    }
  }
  if (callbacks.elicitation || confirmLoginInBrowser) {
    app.onRequest(methods.client.elicitation.create, async ({ params, signal }) => {
      if (CreateElicitationRequest.isUrl(params)) {
        if (!confirmLoginInBrowser || !authenticating || !('requestId' in params))
          throw RequestError.invalidParams('URL elicitation requires an active login request')
        const action = await confirmLoginInBrowser({ url: params.url, message: params.message }, signal)
        return { action }
      }
      if (callbacks.elicitation && CreateElicitationRequest.isForm(params))
        return callbacks.elicitation(params, { signal })
      throw RequestError.invalidParams('Unsupported elicitation mode')
    })
  }
  if (callbacks.readTextFile) app.onRequest(methods.client.fs.readTextFile, callback(callbacks.readTextFile))
  if (callbacks.writeTextFile) app.onRequest(methods.client.fs.writeTextFile, mutation(callbacks.writeTextFile))
  if (callbacks.terminal) {
    app.onRequest(methods.client.terminal.create, mutation(callbacks.terminal.create))
    app.onRequest(methods.client.terminal.output, callback(callbacks.terminal.output))
    app.onRequest(methods.client.terminal.waitForExit, callback(callbacks.terminal.waitForExit))
    app.onRequest(methods.client.terminal.kill, callback(callbacks.terminal.kill))
    app.onRequest(methods.client.terminal.release, callback(callbacks.terminal.release))
  }
  harness?.registerRequests?.((method, schema, handle) => {
    app.onRequest(method, schema, ({ params, signal }) => handle(params, signal))
  })
  const beginPromptUsage = harness?.registerProtocol?.({
    nativeTurn: (event) => options.nativeTurn?.(event),
    onNotification: (method, schema, handle) => {
      orderedNotifications.set(method, (params) => handle(schema.parse(params)))
    }
  })
  const readable = orderedNotifications.size
    ? stream.readable.pipeThrough(
        new TransformStream<WireMessage, WireMessage>({
          async transform(message, controller) {
            if (message && typeof message === 'object' && 'method' in message && !('id' in message)) {
              if (message.method === methods.client.session.update) pendingUpdates++
              const receive = typeof message.method === 'string' && orderedNotifications.get(message.method)
              if (receive) {
                // Private turn boundaries share wire order with validated ACP updates.
                if (pendingUpdates) await deadline((flushedUpdates ??= Promise.withResolvers<void>()).promise)
                receive('params' in message ? message.params : undefined)
                return
              }
            }
            controller.enqueue(message)
          }
        })
      )
    : stream.readable
  const connection = app.connect({ readable, writable: stream.writable })
  const { agent } = connection
  async function sendPrompt(sessionId: string, prompt: PromptRequest['prompt'], metadata?: PromptRequest['_meta']) {
    const usage = beginPromptUsage?.(sessionId)
    try {
      const response = await agent.request(methods.agent.session.prompt, {
        sessionId,
        prompt,
        _meta: usage ? { ...metadata, ...usage.metadata } : metadata
      })
      return { response, usage: readPromptUsage(response) ?? usage?.read(response) }
    } finally {
      usage?.release()
    }
  }
  return {
    signal: connection.signal,
    close: (reason?: Error) => connection.close(reason),
    async initialize() {
      const response = await agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: options.clientInfo,
        clientCapabilities: {
          fs: { readTextFile: !!callbacks.readTextFile, writeTextFile: !!callbacks.writeTextFile && !denyMutation },
          terminal: !!callbacks.terminal && !denyMutation,
          ...((callbacks.elicitation || confirmLoginInBrowser) && {
            elicitation: { ...(callbacks.elicitation && { form: {} }), ...(confirmLoginInBrowser && { url: {} }) }
          }),
          ...(options.sessionCapabilities && { session: options.sessionCapabilities })
        }
      })
      if (response.protocolVersion !== PROTOCOL_VERSION)
        throw new Error(`Unsupported ACP protocol version: ${response.protocolVersion}`)
      const capabilities = response.agentCapabilities
      function bindSession(
        id: string,
        configuration: LoadSessionResponse,
        newSessionMetadata?: NewSessionResponse['_meta']
      ) {
        const legacyModelState = 'models' in configuration ? configuration.models : undefined
        const models = legacyModelsSchema.safeParse(legacyModelState)
        return {
          id,
          prompt: (prompt: PromptRequest['prompt'], metadata?: PromptRequest['_meta']) =>
            sendPrompt(id, prompt, metadata),
          cancel: () => agent.notify(methods.agent.session.cancel, { sessionId: id }),
          close: capabilities?.sessionCapabilities?.close
            ? () => agent.request(methods.agent.session.close, { sessionId: id })
            : undefined,
          setMode: (modeId: string) => agent.request(methods.agent.session.setMode, { sessionId: id, modeId }),
          setConfigOption: (configId: string, value: string | boolean) =>
            agent.request(methods.agent.session.setConfigOption, {
              sessionId: id,
              configId,
              ...(typeof value === 'boolean' ? { type: 'boolean', value } : { value })
            }),
          legacyModels: models.success
            ? {
                ...models.data,
                select: (modelId: string) => agent.request('session/set_model', { sessionId: id, modelId })
              }
            : undefined,
          bindHarness: (currentModel: () => string | undefined) =>
            harness?.bind?.({
              agent,
              agentCapabilities: capabilities,
              initializeMetadata: response._meta,
              sessionId: id,
              newSessionMetadata,
              legacyModelState: configuration.configOptions?.length ? undefined : legacyModelState,
              currentModel
            })
        }
      }
      return {
        response,
        readAccount: (read: AcpAccountReader, launch: Parameters<AcpAccountReader>[2]) => read(agent, response, launch),
        readModelCatalog: (read: AcpModelCatalogReader) => read(agent),
        readSubscriptionUsage: (read: AcpSubscriptionUsageReader, target: Parameters<AcpSubscriptionUsageReader>[2]) =>
          read(agent, response, target),
        async authenticate(methodId: string) {
          if (authenticating) throw new Error('ACP authentication is already running')
          authenticating = true
          try {
            await agent.request(methods.agent.authenticate, { methodId })
          } finally {
            authenticating = false
          }
        },
        async create(config: NewSessionRequest) {
          const configuration = await agent.request(methods.agent.session.new, config)
          if (typeof configuration.sessionId !== 'string' || configuration.sessionId.length === 0)
            throw new Error('Agent returned an empty ACP session ID')
          return { configuration, session: bindSession(configuration.sessionId, configuration, configuration._meta) }
        },
        load: capabilities?.loadSession
          ? async (config: LoadSessionRequest) => {
              const configuration = await agent.request(methods.agent.session.load, config)
              return { configuration, session: bindSession(config.sessionId, configuration) }
            }
          : undefined,
        resume: capabilities?.sessionCapabilities?.resume
          ? async (config: ResumeSessionRequest) => {
              const configuration = await agent.request(methods.agent.session.resume, config)
              return { configuration, session: bindSession(config.sessionId, configuration) }
            }
          : undefined
      }
    }
  }
}

export type AcpClient = ReturnType<typeof connectAcpClient>
export type AcpAgent = Awaited<ReturnType<AcpClient['initialize']>>
export type AcpSession = Awaited<ReturnType<AcpAgent['create']>>['session']

export function acpEffortOption(options: AcpSessionConfiguration['configOptions']) {
  return (
    options?.find((option) => option.type === 'select' && option.category === 'thought_level') ??
    options?.find(
      ({ type, category, id }) =>
        type === 'select' &&
        (category === 'thinking' ||
          category === 'effort' ||
          (category == null && ['thought_level', 'reasoning_effort', 'effort'].includes(id)))
    )
  )
}

export function acpModelCatalog(options: AcpSessionConfiguration['configOptions'], legacy: AcpSession['legacyModels']) {
  const model =
    options?.find((option) => option.type === 'select' && option.category === 'model') ??
    options?.find((option) => option.type === 'select' && option.category == null && option.id === 'model')
  if (model?.type === 'select') {
    return {
      configId: model.id,
      activeModel: { id: model.currentValue },
      models: model.options
        .flatMap((option) => ('group' in option ? option.options : [option]))
        .map(({ value, name, description, _meta }) => ({
          id: value,
          name,
          ...(description != null && { description }),
          ...(_meta != null && { _meta })
        }))
    }
  }
  return {
    configId: undefined,
    activeModel: legacy ? { id: legacy.currentModelId } : undefined,
    models:
      legacy?.availableModels.map(({ modelId, name, description, _meta }) => ({
        id: modelId,
        name,
        ...(description != null && { description }),
        ...(_meta != null && { _meta })
      })) ?? []
  }
}

export function acpAuthMethods(response: InitializeResponse) {
  return (response.authMethods ?? []).map((method) => ({
    id: method.id,
    name: method.name,
    type:
      ('type' in method && method.type === 'terminal') || method._meta?.['terminal-auth']
        ? ('terminal' as const)
        : ('agent' as const)
  }))
}
