import { agent, methods, ndJsonStream, type AgentRequestHandlersByMethod } from '@agentclientprotocol/sdk'

import { runtimeId, type OperationResult } from '@cherrystudio/agent-runtime'

import { createAcpRuntime, type AcpRuntimeOptions } from '../src/v1'

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

export function confirmed<T>(result: OperationResult<T>): T {
  if (result.status !== 'confirmed') throw new Error(JSON.stringify(result))
  return result.value
}

export const configuration = { cwd: '/fixture/workspace', mcpServers: [] }
export const input = (text = 'hello', id = text) => ({
  inputId: runtimeId<'input'>(id),
  text,
  whenBusy: 'reject' as const
})

export function fixture(handlers: Partial<AgentRequestHandlersByMethod> = {}, host: Partial<AcpRuntimeOptions> = {}) {
  const outgoing = new TransformStream<Uint8Array, Uint8Array>()
  let incomingController!: TransformStreamDefaultController<Uint8Array>
  const incoming = new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      incomingController = controller
    }
  })
  let sequence = 0
  const cancelled = deferred<void>()
  const errors: unknown[] = []
  const app = agent({ name: 'fixture' })
    .onRequest(
      methods.agent.initialize,
      handlers.initialize ??
        (() => ({
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: { image: true, audio: true, embeddedContext: true }
          },
          authMethods: []
        }))
    )
    .onRequest(methods.agent.session.new, handlers['session/new'] ?? (() => ({ sessionId: `session-${++sequence}` })))
    .onRequest(methods.agent.session.load, handlers['session/load'] ?? (() => ({})))
    .onRequest(
      methods.agent.session.prompt,
      handlers['session/prompt'] ??
        (async ({ client, params }) => {
          await client.notify(methods.client.session.update, {
            sessionId: params.sessionId,
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer' } }
          })
          return { stopReason: 'end_turn' }
        })
    )
    .onNotification(methods.agent.session.cancel, () => cancelled.resolve())
  if (handlers.authenticate) app.onRequest(methods.agent.authenticate, handlers.authenticate)
  if (handlers['session/set_mode']) app.onRequest(methods.agent.session.setMode, handlers['session/set_mode'])
  if (handlers['session/set_config_option'])
    app.onRequest(methods.agent.session.setConfigOption, handlers['session/set_config_option'])
  const peer = app.connect(ndJsonStream(incoming.writable, outgoing.readable))
  const runtime = createAcpRuntime({
    backendId: runtimeId<'backend'>('fixture'),
    connect: async () => ({
      stream: ndJsonStream(outgoing.writable, incoming.readable),
      closeAndJoin: async () => {
        peer.close()
        await peer.closed
      }
    }),
    loadConfiguration: async () => configuration,
    report: (error) => errors.push(error),
    ...host
  })
  return {
    runtime,
    peer,
    cancelled,
    errors,
    disconnect: () => {
      incomingController.error(new Error('Disconnected'))
      peer.close()
    },
    cleanup: async () => {
      peer.close()
      await runtime.shutdown()
      await peer.closed
    }
  }
}
