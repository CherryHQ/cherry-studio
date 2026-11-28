import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

import {
  createJSONRPCErrorResponse,
  createJSONRPCSuccessResponse,
  JSONRPCClient,
  JSONRPCErrorException,
  type JSONRPCRequest
} from 'json-rpc-2.0'
import * as z from 'zod'

import type { ClientInfo, CodexRequestParams, CodexServerReplies } from './protocol'
import { responses } from './responses'

type CodexResponse<M extends keyof typeof responses> = z.output<(typeof responses)[M]>
const responseSchemas: { [M in keyof typeof responses]: z.ZodType<CodexResponse<M>> } = responses

export type { CodexRequestParams } from './protocol'
export { JSONRPCErrorException as CodexRequestError } from 'json-rpc-2.0'

const id = z.union([z.string(), z.number()])
const incomingCall = z.object({
  method: z.string(),
  id: id.optional(),
  params: z.record(z.string(), z.unknown()).optional()
})
const incomingReply = z.union([
  z.object({ id, error: z.object({ code: z.number(), message: z.string(), data: z.unknown().optional() }) }),
  z.object({ id, result: z.unknown().nonoptional() })
])

export type CodexServerCall = { method: string; params: Record<string, unknown> }
export type CodexIncomingRequest = CodexServerCall & { id: string | number }
export type CodexRequestHandlers = {
  [M in keyof CodexServerReplies]?: (call: CodexIncomingRequest) => Promise<CodexServerReplies[M]>
}
export interface CodexClientHandlers {
  onNotification?(call: CodexServerCall): void
  requests?: CodexRequestHandlers
  onDisconnect?(reason: Error): void
}

export function connectCodexAppServer(
  stdin: Writable,
  stdout: Readable,
  clientInfo: ClientInfo,
  handlers: CodexClientHandlers = {}
) {
  const lines = createInterface({ input: stdout, crlfDelay: Infinity })
  let closed: Error | undefined

  function write(frame: object): Promise<void> {
    if (closed) return Promise.reject(closed)
    return new Promise<void>((resolve, reject) => {
      stdin.write(JSON.stringify(frame) + '\n', (error) => (error ? reject(error) : resolve()))
    })
  }

  type WireHook = (id: string | number) => void
  const bindings = new Map<string | number, (value: unknown) => void>()
  const rpc = new JSONRPCClient<WireHook | undefined>(({ method, id, params }: JSONRPCRequest, register) => {
    if (id != null) register?.(id)
    void write({ method, id, params }).catch(disconnected)
  })
  const requests = rpc.timeout(30_000)

  function close(reason?: Error) {
    if (closed) return
    closed = reason ?? new Error('Codex connection closed')
    lines.close()
    rpc.rejectAllPendingRequests(closed.message)
    if (reason) handlers.onDisconnect?.(reason)
  }

  function disconnected(error: unknown) {
    close(error instanceof Error ? error : new Error(String(error)))
  }

  async function handleRequest(requestId: string | number, call: CodexServerCall) {
    let reply
    try {
      const { requests } = handlers
      const result =
        requests && hasMethod(requests, call.method)
          ? await requests[call.method]?.({ ...call, id: requestId })
          : undefined
      reply = result === undefined ? { error: { code: -32601, message: 'Unsupported client request' } } : { result }
    } catch (error) {
      reply = {
        error:
          error instanceof JSONRPCErrorException ? error.toObject() : { code: -32603, message: 'Client request failed' }
      }
    }
    if (!closed) await write({ id: requestId, ...reply })
  }

  function receive(line: string) {
    const message: unknown = JSON.parse(line)
    if (message && typeof message === 'object' && 'method' in message) {
      const { method, id, params = {} } = incomingCall.parse(message)
      if (id === undefined) handlers.onNotification?.({ method, params })
      else void handleRequest(id, { method, params }).catch(disconnected)
    } else {
      const reply = incomingReply.parse(message)
      const bound = bindings.get(reply.id)
      bindings.delete(reply.id)
      if ('result' in reply && bound) {
        try {
          bound(reply.result)
        } catch (error) {
          rpc.receive(
            createJSONRPCErrorResponse(reply.id, -32603, error instanceof Error ? error.message : String(error))
          )
          return
        }
      }
      rpc.receive(
        'error' in reply
          ? createJSONRPCErrorResponse(reply.id, reply.error.code, reply.error.message, reply.error.data)
          : createJSONRPCSuccessResponse(reply.id, reply.result)
      )
    }
  }

  stdin.on('error', disconnected)
  stdin.once('close', () => {
    stdin.off('error', disconnected)
    close(new Error('Codex input closed'))
  })
  stdin.once('finish', () => close(new Error('Codex input closed')))
  stdout.once('close', () => close(new Error('Codex output closed')))
  lines.on('error', disconnected)
  lines.once('close', () => close(new Error('Codex output closed')))
  lines.on('line', (line) => {
    if (closed) return
    try {
      receive(line)
    } catch (error) {
      disconnected(error)
    }
  })

  async function request<M extends Exclude<keyof CodexRequestParams, 'initialize'>>(
    method: M,
    params: CodexRequestParams[M],
    onReply?: (result: CodexResponse<M>) => void
  ): Promise<CodexResponse<M>> {
    if (closed) throw closed
    const schema = responseSchemas[method]
    let boundId: string | number | undefined
    let parsed: CodexResponse<M> | undefined
    try {
      const value: unknown = await requests.request(
        method,
        params,
        onReply &&
          ((id) => {
            boundId = id
            bindings.set(id, (raw) => {
              const response = schema.parse(raw)
              parsed = response
              onReply(response)
            })
          })
      )
      return parsed ?? schema.parse(value)
    } finally {
      if (boundId !== undefined) bindings.delete(boundId)
    }
  }

  async function listModels() {
    const models: CodexResponse<'model/list'>['data'] = []
    let cursor: string | null = null
    do {
      const page: CodexResponse<'model/list'> = await request('model/list', { cursor })
      models.push(...page.data)
      cursor = page.nextCursor ?? null
    } while (cursor)
    return models
  }

  async function initialize() {
    try {
      if (!stdin.writable || !stdout.readable) throw new Error('Codex stdio is unavailable')
      const params: CodexRequestParams['initialize'] = {
        clientInfo,
        capabilities: { experimentalApi: true, requestAttestation: false }
      }
      const { userAgent } = z
        .object({ userAgent: z.string() })
        .parse(await requests.request('initialize', params, undefined))
      await write({ method: 'initialized' })
      if (closed) throw closed
      const version = /\/(\d+)\.(\d+)\.\d+/.exec(userAgent)
      const atLeast = (minor: number) => !!version && (Number(version[1]) > 0 || Number(version[2]) >= minor)
      return { request, listModels, atLeast }
    } catch (error) {
      disconnected(error)
      throw error
    }
  }

  return { ready: initialize(), close }
}

export type CodexAppServerClient = Awaited<ReturnType<typeof connectCodexAppServer>['ready']>

function hasMethod(handlers: CodexRequestHandlers, method: string): method is keyof CodexServerReplies {
  return Object.hasOwn(handlers, method)
}
