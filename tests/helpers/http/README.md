# Shared HTTP test helpers

These helpers serve Node-based unit/integration tests and Playwright E2E scenarios
without importing Electron, application services, or a test runner.
[`server.ts`](server.ts) provides generic HTTP/HTTPS servers and unused ports.

## Mock chat server

[`mockChatServer.ts`](mockChatServer.ts) starts a real HTTP server on an ephemeral
`127.0.0.1` port. `baseUrl` includes `/v1`; `modelId` is `mock-chat`. Configure an
OpenAI-compatible provider with those values and a dummy API key. The server does
not require authentication or retain authorization headers. It accepts any model
name and echoes the requested model in responses.

Supported endpoints:

- `GET /v1/models`: exposes `mock-chat` for provider discovery.
- `POST /v1/chat/completions`: JSON completion or SSE according to `stream`.

This fixture implements text chat only. It does not implement Responses,
Anthropic Messages, legacy `/completions`, tool calls, or token accounting.
Unknown endpoints return 404 and malformed requests return 400.

`nextRequest()` returns a separate controller for each request, in arrival order.
It works before or after the HTTP request arrives, times out after 10 seconds
(override with `nextRequest(timeoutMs)`), and rejects when the server closes.
Inspect `request.body` to ensure the request belongs to the expected chat;
background title generation and retries are separate requests and need their own
controllers. No response content is generated automatically.

| Controller API | Effect |
| --- | --- |
| `sendText(text)` | Sends one SSE text delta; requires `stream: true` |
| `complete(text?)` | Sends optional final text and finishes normally; SSE includes a stop chunk and `[DONE]` |
| `fail(message)` | Sends an SSE provider error and `[DONE]`, or HTTP 500 for non-streaming requests |
| `disconnect()` | Destroys the socket without a finish chunk or `[DONE]` |
| `closed` | Resolves on response closure, including client cancellation; does not identify who closed it |

Use receipt of the prefix as the synchronization point for a streaming fault.
Writing a delta only queues bytes; it does not prove the UI has rendered them.

### Vitest

Import through `@test-helpers/http/mockChatServer` in main-process tests. Each test
gets an isolated server on its own port; there is no global state or Electron launch.
Start the client call before awaiting the request controller:

```ts
import { createOpenAI } from '@ai-sdk/openai'
import { startMockChatServer } from '@test-helpers/http/mockChatServer'
import { expect, it } from 'vitest'

it('receives a chat completion', async () => {
  const server = await startMockChatServer()
  try {
    const model = createOpenAI({ baseURL: server.baseUrl, apiKey: 'mock-key' }).chat(server.modelId)
    const result = model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]
    })
    const request = await server.nextRequest()
    request.complete('Hello back')
    expect((await result).content).toEqual([{ type: 'text', text: 'Hello back' }])
  } finally {
    await server.close()
  }
})
```

For streaming, send the first text before awaiting `doStream()`: the OpenAI adapter
waits for meaningful output before resolving. Then await consumption of that text
before calling `fail()` or `disconnect()`.

### Playwright

For example, within a Playwright scenario after configuring and selecting the
mock provider, with `composer` and `assistantMessage` scoped to this chat:

```ts
// From tests/e2e/regression/*.spec.ts
import { startMockChatServer } from '../../helpers/http/mockChatServer'

const server = await startMockChatServer()
try {
  // Configure/select the provider using server.baseUrl and server.modelId here.
  const incoming = server.nextRequest()
  await composer.fill('Test interrupted response')
  await composer.press('Enter')
  const request = await incoming
  request.sendText('Keep this partial answer')
  await expect(assistantMessage).toContainText('Keep this partial answer')
  request.disconnect()
  await request.closed
  // Assert the UI error, persisted partial text, and restart persistence here.
} finally {
  await server.close()
}
```

Replace `disconnect()` with `fail('upstream unavailable')` for provider errors,
or `complete(' final text')` for success. To test user stop, click the app's stop
button and await `request.closed`; do not call `disconnect()` on its behalf.
Always close the server in teardown: `close()` terminates unfinished requests,
rejects pending waits, and is safe to call again.

The real HTTP boundary covers requests from Electron's main process, which
renderer `page.route()` interception cannot control. These fixture tests verify
the protocol with both installed OpenAI SDK adapters:

```sh
pnpm test:main tests/helpers/http/__tests__/mockChatServer.test.ts
```

They do not verify desktop rendering or message persistence. Those assertions
belong in the [regression scenarios](../../e2e/regression/README.md).
