import { startChatEfficiencyServer } from '../../../../tests/e2e/regression/fixtures/chatEfficiencyServer'

it('finishes the tool turn when an image result adds a supplementary user message', async () => {
  const server = await startChatEfficiencyServer()
  try {
    const response = await fetch(`${server.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(2_000),
      body: JSON.stringify({
        model: server.modelId,
        stream: true,
        messages: [
          { role: 'user', content: 'MP18_IMAGE_URL: Use the image tool.' },
          { role: 'assistant', tool_calls: [{ id: 'image-call', type: 'function', function: { name: 'image' } }] },
          { role: 'tool', tool_call_id: 'image-call', content: 'Image tool completed' },
          { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }
        ]
      })
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('MP18_IMAGE_DONE')
  } finally {
    await server.close()
  }
})
