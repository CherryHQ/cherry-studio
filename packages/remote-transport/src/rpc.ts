import { createJSONRPCErrorResponse, JSONRPCErrorException, JSONRPCServer, type JSONRPCResponse } from 'json-rpc-2.0'

import {
  jsonRpcNotificationSchema,
  jsonRpcRequestSchema,
  remoteLimits,
  type RemoteFailure
} from '@cherrystudio/remote-protocol'

interface Schema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown }
  parse(input: unknown): T
}

export class RemoteRpcError extends JSONRPCErrorException {
  constructor(reason: RemoteFailure['reason'], message: string, details?: RemoteFailure['details']) {
    super(message, 1000, { reason, message, ...(details ? { details } : {}) })
    // json-rpc-2.0 resets the prototype to its base exception, losing subclass identity.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class RemoteRpcServer<Context> {
  private readonly server: JSONRPCServer<Context>
  private readonly active = new Set<string>()

  constructor(onError: (message: string, error: unknown) => void) {
    this.server = new JSONRPCServer({ errorListener: onError })
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
    this.server.addMethod(name, async (params: unknown, context) => {
      const input = schema.params.safeParse(params ?? {})
      if (!input.success) throw new JSONRPCErrorException('Invalid params', -32602)
      return schema.result.parse(await handler(input.data, context))
    })
  }

  async receive(input: unknown, context: Context): Promise<JSONRPCResponse | JSONRPCResponse[] | null> {
    if (!Array.isArray(input)) return this.receiveOne(input, context)
    if (!input.length || input.length > remoteLimits.batchEntries)
      return createJSONRPCErrorResponse(null, -32600, 'Invalid batch')
    const responses = (await Promise.all(input.map((value) => this.receiveOne(value, context)))).filter(
      (value) => value !== null
    )
    return responses.length ? responses : null
  }

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
