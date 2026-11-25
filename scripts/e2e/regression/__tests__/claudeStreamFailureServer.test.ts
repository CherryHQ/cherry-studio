import { startClaudeStreamFailureServer } from '../../../../tests/e2e/regression/fixtures/claudeStreamFailureServer'

it('interrupts a Claude Messages stream on demand and completes the recovery turn', async () => {
  const partial = 'The first segment is visible.'
  const recovery = 'The next turn completes.'
  const mock = await startClaudeStreamFailureServer('Start', partial, 'Continue', recovery)
  const send = (content: string) =>
    fetch(`${mock.baseUrl}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: mock.modelId,
        max_tokens: 128,
        stream: true,
        messages: [{ role: 'user', content }]
      }),
      signal: AbortSignal.timeout(5_000)
    })

  try {
    const initial = await send('Start')
    expect(initial.status).toBe(200)
    const reader = initial.body!.getReader()
    const decoder = new TextDecoder()
    let events = ''
    while (!events.includes(partial)) {
      const { value, done } = await reader.read()
      if (done) throw new Error('Stream ended before the partial text')
      events += decoder.decode(value, { stream: true })
    }
    expect(events).toContain('event: content_block_delta')
    expect(events).not.toContain('This continuation')
    mock.disconnect()
    await expect(reader.read()).rejects.toThrow('terminated')

    const followUp = await send('Continue')
    expect(followUp.status).toBe(200)
    const completedEvents = await followUp.text()
    const text = completedEvents
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)))
      .map((event) => (event.delta?.type === 'text_delta' ? event.delta.text : ''))
      .join('')
    expect(text).toBe(recovery)
    expect(completedEvents).toContain('event: message_stop')

    const unknown = await send('Unexpected')
    expect(unknown.status).toBe(503)
    await unknown.text()
    expect(mock.getRequests().map(({ path, response }) => [path, response.status, response.interrupted])).toEqual([
      ['/v1/messages', 200, true],
      ['/v1/messages', 200, undefined],
      ['/v1/messages', 503, undefined]
    ])
  } finally {
    await mock.close()
  }
})
