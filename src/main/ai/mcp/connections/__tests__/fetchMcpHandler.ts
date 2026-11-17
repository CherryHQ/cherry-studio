import type { McpHttpHandler } from '@modelcontextprotocol/server'

/** Serves a StreamableHTTPClientTransport from an in-process handler, for HTTP-wire tests. */
export async function fetchMcpHandler(
  handler: McpHttpHandler,
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const request = input instanceof Request && !init ? input : new Request(input, init)
  const signal = init?.signal ?? request.signal
  const response = await handler.fetch(request)
  if (!response.body) return response
  // Native fetch cancels its response stream when aborted; the in-process bridge must do the same.
  return new Response(response.body.pipeThrough(new TransformStream(), { signal }), response)
}
