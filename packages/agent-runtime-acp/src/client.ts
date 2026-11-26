import {
  client,
  methods,
  PROTOCOL_VERSION,
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

import type { AcpHarnessAdapter } from './harness'
import type { AcpClientCallbacks, AcpSessionConfiguration } from './types'
import { readPromptUsage } from './usage'

const legacyModelsSchema = z.object({
  currentModelId: z.string(),
  availableModels: z.array(z.object({ modelId: z.string(), name: z.string() }))
})

export interface AcpClientOptions {
  clientInfo: NonNullable<InitializeRequest['clientInfo']>
  sessionCapabilities?: NonNullable<InitializeRequest['clientCapabilities']>['session']
  /** Reject unsolicited host writes and terminal creation when the host advertises read-only access. */
  denyMutation?(sessionId: string): Error
  callbacks: AcpClientCallbacks
  update(notification: SessionNotification): void
  harness?: AcpHarnessAdapter
}

/** One reader for the supplied stream. Live notifications and prompt responses are delivered without retaining history. */
export function connectAcpClient(stream: Stream, options: AcpClientOptions) {
  const { callbacks, harness, denyMutation } = options
  const app = client({ name: options.clientInfo.name })
    .onNotification(methods.client.session.update, ({ params }) => options.update(params))
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
  if (callbacks.elicitation) app.onRequest(methods.client.elicitation.create, callback(callbacks.elicitation))
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
  const beginPromptUsage = harness?.registerPromptUsage?.({
    onNotification: (method, schema, handle) => {
      app.onNotification(method, schema, ({ params }) => handle(params))
    }
  })
  const connection = app.connect(stream)
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
          ...(callbacks.elicitation && { elicitation: { form: {} } }),
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
              sessionId: id,
              newSessionMetadata,
              legacyModelState: configuration.configOptions?.length ? undefined : legacyModelState,
              currentModel
            })
        }
      }
      return {
        response,
        async authenticate(methodId: string) {
          await agent.request(methods.agent.authenticate, { methodId })
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
  const model = options?.find((option) => option.category === 'model' && option.type === 'select')
  if (model?.type === 'select') {
    return {
      configId: model.id,
      activeModel: { id: model.currentValue },
      models: model.options
        .flatMap((option) => ('group' in option ? option.options : [option]))
        .map(({ value, name }) => ({ id: value, name }))
    }
  }
  return {
    configId: undefined,
    activeModel: legacy ? { id: legacy.currentModelId } : undefined,
    models: legacy?.availableModels.map(({ modelId, name }) => ({ id: modelId, name })) ?? []
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
