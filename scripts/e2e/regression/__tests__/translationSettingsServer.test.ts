import { startTranslationSettingsServer } from '../../../../tests/e2e/regression/fixtures/translationSettingsServer'

it('serves detection and streaming translation with distinct usage through aiMock, and rejects unrelated input', async () => {
  const server = await startTranslationSettingsServer()
  const request = (messages: unknown[], stream = false) =>
    fetch(`${server.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(2_000),
      body: JSON.stringify({ model: 'translation-model', messages, stream, stream_options: { include_usage: true } })
    })
  try {
    const detected = await request([
      { role: 'system', content: `You precisely identify the language. <text>${server.inputs[0]}</text>` },
      { role: 'user', content: 'follow system prompt' }
    ])
    expect(detected.status).toBe(200)
    expect(await detected.json()).toMatchObject({
      choices: [{ message: { content: 'zh-cn' } }],
      usage: { prompt_tokens: 17, completion_tokens: 3, total_tokens: 20 }
    })
    const translated = await request([{ role: 'user', content: server.inputs[1] }], true)
    expect(translated.status).toBe(200)
    const chunks = (await translated.text())
      .split('\n')
      .filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'))
      .map((line) => JSON.parse(line.slice(6)))
    expect(
      chunks
        .flatMap((chunk) => chunk.choices.map((choice: { delta: { content?: string } }) => choice.delta.content ?? ''))
        .join('')
    ).toBe(server.answers[1])
    expect(chunks.find((chunk) => chunk.usage)?.usage).toMatchObject({
      prompt_tokens: 29,
      completion_tokens: 11,
      total_tokens: 40
    })
    const unmatched = await request([{ role: 'user', content: 'not a translation fixture' }])
    expect(unmatched.status).toBe(503)
    await unmatched.text()
    expect(server.requests).toHaveLength(3)
    expect(server.requests[1]).toMatchObject({ model: 'translation-model', stream: true })
  } finally {
    await server.close()
  }
})
