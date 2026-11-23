import { createJSONRPCErrorResponse, JSONRPCErrorException, JSONRPCServer, type JSONRPCResponse } from 'json-rpc-2.0'

import {
  jsonRpcNotificationSchema,
  jsonRpcRequestSchema,
  remoteLimits,
  type JsonRpcRequest,
  type RemoteFailure
} from '@cherrystudio/remote-protocol'

interface Schema<T> {
  safeParse(
    input: NonNullable<JsonRpcRequest['params']>
  ): { success: true; data: T } | { success: false; error: unknown }
  parse(input: NoInfer<T>): T
}

export class RemoteRpcError extends JSONRPCErrorException {
  constructor(reason: RemoteFailure['reason'], message: string, details?: RemoteFailure['details']) {
    const failure: RemoteFailure = { reason, message }

    if (details) failure.details = details
    super(message, 1000, failure)
    // json-rpc-2.0 resets the prototype to its base exception, losing subclass identity.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class RemoteRpcServer<Context> {
  private readonly server: JSONRPCServer<Context>
  private readonly active = new Set<string>()

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The JSON-RPC library reports arbitrary handler rejections; forward their original diagnostics to the host logger.
  constructor(onError: (message: string, error: unknown) => void) {
    this.server = new JSONRPCServer({ errorListener: onError })
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Handlers may reject any value; only the library's explicit RPC exception may expose a typed protocol error.
    this.server.mapErrorToJSONRPCErrorResponse = (id, error: unknown) =>
      error instanceof JSONRPCErrorException
        ? createJSONRPCErrorResponse(id, error.code, error.message, error.data)
        : createJSONRPCErrorResponse(id, -32603, 'Internal error')
  }

  addMethod<Input, Output>(
    name: string,
    schema: { params: Schema<Input>; result: Schema<Output> },
    handler: (params: Input, context: Context) => Output | Promise<Output>
  ): void {
    this.server.addMethod(name, async (params: JsonRpcRequest['params'], context) => {
      const input = schema.params.safeParse(params ?? {})

      if (!input.success) throw new JSONRPCErrorException('Invalid params', -32602)

      return schema.result.parse(await handler(input.data, context))
    })
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Incoming control records are untrusted RPC payloads; each batch entry is validated independently before dispatch.
  async receive(input: unknown, context: Context): Promise<JSONRPCResponse | JSONRPCResponse[] | null> {
    if (!Array.isArray(input)) return this.receiveOne(input, context)

    if (!input.length || input.length > remoteLimits.batchEntries)
      return createJSONRPCErrorResponse(null, -32600, 'Invalid batch')

    const responses = (await Promise.all(input.map((value) => this.receiveOne(value, context)))).filter(
      (value) => value !== null
    )

    return responses.length ? responses : null
  }

  /**
   * Answers an input that admission control above the server refused to dispatch.
   * Notifications get no reply; batches answer per entry, mirroring `receive`.
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Admission can reject a raw record before dispatch; validate IDs and notification shape before producing per-entry refusals.
  refuse(input: unknown, failure: RemoteFailure): JSONRPCResponse | JSONRPCResponse[] | null {
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Rejected batch entries may be malformed values; request/notification schemas own the response-ID decision.
    const refuseOne = (value: unknown): JSONRPCResponse | null => {
      if (jsonRpcNotificationSchema.safeParse(value).success) return null
      const parsed = jsonRpcRequestSchema.safeParse(value)

      if (!parsed.success) return createJSONRPCErrorResponse(null, -32600, 'Invalid request')

      return createJSONRPCErrorResponse(parsed.data.id, 1000, failure.message, failure)
    }

    if (!Array.isArray(input)) return refuseOne(input)

    if (!input.length || input.length > remoteLimits.batchEntries)
      return createJSONRPCErrorResponse(null, -32600, 'Invalid batch')
    const responses = input.map(refuseOne).filter((value) => value !== null)

    return responses.length ? responses : null
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Each raw batch entry must pass request validation before handler parameters and duplicate-ID ownership are trusted.
  private async receiveOne(input: unknown, context: Context): Promise<JSONRPCResponse | null> {
    if (jsonRpcNotificationSchema.safeParse(input).success) return null
    const parsed = jsonRpcRequestSchema.safeParse(input)

    if (!parsed.success) return createJSONRPCErrorResponse(null, -32600, 'Invalid request')
    const request = parsed.data
    const key = `${typeof request.id}:${String(request.id)}`

    if (this.active.has(key)) return createJSONRPCErrorResponse(request.id, -32600, 'Duplicate active request ID')

    if (this.active.size >= remoteLimits.inFlightRequests)
      return createJSONRPCErrorResponse(request.id, 1000, 'Request limit exceeded', {
        reason: 'RESOURCE_EXHAUSTED',
        message: 'Request limit exceeded'
      })
    this.active.add(key)

    try {
      return await this.server.receive(request, context)
    } finally {
      this.active.delete(key)
    }
  }
}
