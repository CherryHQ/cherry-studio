import type { ServerResponse } from 'node:http'

import { createServer } from '@copilotkit/aimock'

export async function startClaudeStreamFailureServer(
  prompt: string,
  partialText: string,
  recoveryPrompt: string,
  recoveryText: string
) {
  const modelId = 'regression-claude-stream'
  const path = '/v1/messages'
  const mock = await createServer(
    [
      {
        match: { model: modelId, userMessage: prompt, predicate: ({ stream }) => stream === true },
        response: { content: partialText + 'This continuation must never reach the client.' },
        chunkSize: partialText.length,
        // Hold the next delta until Playwright has seen the first one and cuts the connection.
        recordedTimings: { ttftMs: 0, interChunkDelaysMs: [0, 0, 60_000], totalDurationMs: 60_000 }
      },
      {
        match: { model: modelId, userMessage: recoveryPrompt, predicate: ({ stream }) => stream === true },
        response: { content: recoveryText }
      }
    ],
    { port: 0, host: '127.0.0.1', strict: true, logLevel: 'silent' }
  )
  let firstResponse: ServerResponse | undefined
  mock.server.prependListener('request', (request, response) => {
    if (request.method === 'POST' && request.url === path) firstResponse ??= response
  })
  return {
    baseUrl: `${mock.url}/v1`,
    modelId,
    disconnect() {
      if (!firstResponse || firstResponse.destroyed || firstResponse.writableEnded) {
        throw new Error('Expected an open Claude Messages response')
      }
      firstResponse.destroy()
    },
    getRequests: () => mock.journal.getAll(),
    close: () =>
      new Promise<void>((resolve, reject) => {
        mock.server.close((error) => (error ? reject(error) : resolve()))
        mock.server.closeAllConnections()
      })
  }
}
