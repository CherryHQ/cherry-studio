/**
 * Wire-level guard for the official DeepSeek chat route (`deepseek.chat` → POST
 * `/chat/completions`): backslash/escape-like message content must serialize as
 * valid JSON with every content value preserved byte-exact. Asserts on the RAW
 * body string — suites that `JSON.parse` before asserting cannot observe a
 * truncated `\u` escape by construction (#20476).
 */
import { createDeepSeek } from '@ai-sdk/deepseek'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'

// Flags `\u` with fewer than 4 hex digits (the reported failure shape).
// Odd-backslash runs only, so sent `\\u0041` text is not flagged.
const INCOMPLETE_HEX_ESCAPE = /(?:^|[^\\])(?:\\\\)*\\u(?![0-9a-fA-F]{4})/

// Backslash shapes from long real-world chats: trailing/repeated backslashes,
// literal `\uXXXX` text, truncated-looking escapes, Windows paths, regex.
const BACKSLASH_CORPUS = [
  'trailing backslash C:\\temp\\',
  'repeated \\\\\\\\ slashes',
  'literal escape \\u0041 stays literal text',
  'truncated-looking \\u12 and bare \\u fragments',
  'windows path C:\\new\\test\\file.txt',
  'regex ^\\d+\\.\\d+$ with \\x41 hex form',
  'quote " plus newline\n mixed with backslash \\',
  'emoji \\u{1F600} brace form',
  'lone surrogate \uD800 here'
]

function multiTurnPrompt(turns: number): LanguageModelV3CallOptions['prompt'] {
  const prompt: LanguageModelV3CallOptions['prompt'] = []
  for (let i = 0; i < turns; i++) {
    const text = `${BACKSLASH_CORPUS[i % BACKSLASH_CORPUS.length]} (#${i})`
    prompt.push(
      { role: 'user', content: [{ type: 'text', text }] },
      { role: 'assistant', content: [{ type: 'text', text: `ack ${text}` }] }
    )
  }
  prompt.push({
    role: 'user',
    content: [{ type: 'text', text: `final ${BACKSLASH_CORPUS[0]}` }]
  })
  return prompt
}

async function captureRawBody(run: (fetch: typeof globalThis.fetch) => Promise<unknown>) {
  let rawBody: unknown
  let url = ''
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    url = String(input instanceof URL ? input.href : input instanceof Request ? input.url : input)
    rawBody = init?.body
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }),
      { headers: { 'content-type': 'application/json' } }
    )
  }) as typeof globalThis.fetch
  await run(fetch)
  expect(typeof rawBody).toBe('string')
  return { rawBody: rawBody as string, url }
}

describe('DeepSeek chat serialization — backslash content stays valid JSON', () => {
  it('serializes a long backslash-laden multi-turn history as parseable JSON with contents intact', async () => {
    const prompt = multiTurnPrompt(30)
    const { rawBody, url } = await captureRawBody((fetch) =>
      createDeepSeek({ apiKey: 'sk-test', fetch }).chat('deepseek-chat').doGenerate({ prompt })
    )

    expect(url).toMatch(/\/chat\/completions$/)
    // The wire-validity invariant itself: must parse, or the provider 400s.
    const body = JSON.parse(rawBody) as { messages: Array<{ role: string; content: unknown }> }
    expect(body.messages).toHaveLength(prompt.length)
    body.messages.forEach((message, index) => {
      const input = prompt[index] as { content: Array<{ text: string }> }
      // Text-only parts concatenate into one wire string (array form only
      // with image parts); every value must round-trip byte-exact.
      expect(message.content).toBe(input.content.map((part) => part.text).join(''))
    })
  })

  it('emits no incomplete hex escape in the raw wire body', async () => {
    const { rawBody } = await captureRawBody((fetch) =>
      createDeepSeek({ apiKey: 'sk-test', fetch })
        .chat('deepseek-chat')
        .doGenerate({ prompt: multiTurnPrompt(30) })
    )

    expect(rawBody).not.toMatch(INCOMPLETE_HEX_ESCAPE)
  })

  it('preserves backslashes inside replayed reasoning_content', async () => {
    const reasoning = 'path C:\\new\\test with literal \\u0041 and trailing \\'
    // V4 ids echo prior-turn reasoning via `reasoning_content` (legacy
    // `deepseek-chat` intentionally drops it on the R1 path).
    const { rawBody } = await captureRawBody((fetch) =>
      createDeepSeek({ apiKey: 'sk-test', fetch })
        .chat('deepseek-v4')
        .doGenerate({
          prompt: [
            {
              role: 'assistant',
              content: [
                { type: 'reasoning', text: reasoning },
                { type: 'text', text: 'done' }
              ]
            },
            { role: 'user', content: [{ type: 'text', text: 'continue' }] }
          ]
        })
    )

    const body = JSON.parse(rawBody) as { messages: Array<{ reasoning_content?: string }> }
    expect(body.messages[0].reasoning_content).toBe(reasoning)
    expect(rawBody).not.toMatch(INCOMPLETE_HEX_ESCAPE)
  })
})
