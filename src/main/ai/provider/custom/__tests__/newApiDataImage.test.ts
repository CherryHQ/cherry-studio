import { streamText } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { normalizeNewApiDataImages } from '../newApiDataImage'
import { createNewApi } from '../newapiProvider'

const INLINE_PNG = 'data:image/png;base64,iVBORw0KGgo='

function jsonResponse(content: string): Response {
  return Response.json({
    id: 'chatcmpl-image',
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  })
}

function event(content: string): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-image',
    choices: [{ delta: { content }, finish_reason: null }],
    usage: null
  })}\n\n`
}

function finishEvent(): string {
  return `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`
}

describe('New API data-image compatibility', () => {
  it('turns a Markdown data image in a JSON response into an SDK file part', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(`Here: ![result](${INLINE_PNG})`))
    const model = createNewApi({ apiKey: 'sk-test', baseURL: 'https://newapi.test/v1', fetch }).languageModel('image')

    const result = await model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'draw' }] }] })

    expect(result.content).toMatchObject([
      { type: 'text', text: 'Here: ' },
      { type: 'file', mediaType: 'image/png', data: 'iVBORw0KGgo=' }
    ])
  })

  it('extracts an SSE data image split across chunks without exposing base64 as text', async () => {
    const encoder = new TextEncoder()
    const body = `${event('Here: ')}${event(`![result](${INLINE_PNG})`)}${finishEvent()}data: [DONE]\n\n`
    const split = body.indexOf('iVBOR') + 5
    const chunks = [body.slice(0, split), body.slice(split)]
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
            controller.close()
          }
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      )
    )
    const model = createNewApi({ apiKey: 'sk-test', baseURL: 'https://newapi.test/v1', fetch }).languageModel('image')

    const result = streamText({
      model,
      prompt: 'draw',
      maxRetries: 0
    })
    await result.consumeStream()

    expect(await result.text).toBe('Here: ')
    expect(await result.files).toMatchObject([{ mediaType: 'image/png', base64: 'iVBORw0KGgo=' }])
  })

  it('reassembles Markdown images across SSE content deltas, not just transport chunks', async () => {
    const markdown = `![result](${INLINE_PNG})`
    const body = `${[...markdown].map(event).join('')}${event(' done')}${finishEvent()}data: [DONE]\n\n`
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    const model = createNewApi({ apiKey: 'sk-test', baseURL: 'https://newapi.test/v1', fetch }).languageModel('image')
    const result = streamText({ model, prompt: 'draw', maxRetries: 0 })
    await result.consumeStream()
    expect(await result.text).toBe(' done')
    expect(await result.files).toMatchObject([{ mediaType: 'image/png', base64: 'iVBORw0KGgo=' }])
  })

  it('leaves ordinary image links as Markdown text', async () => {
    const content = '![public](https://images.example.com/result.png)'
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(content))
    const model = createNewApi({ apiKey: 'sk-test', baseURL: 'https://newapi.test/v1', fetch }).languageModel('image')

    const result = await model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'draw' }] }] })

    expect(result.content).toEqual([{ type: 'text', text: content }])
  })

  it('streams a plain Markdown link that only looked like a data image for one delta', async () => {
    // `![` alone is a valid data-image prefix, so the first delta is held; the `h` of `https`
    // must then release it in order rather than drop or duplicate it.
    const body = `${event('See ![pub')}${event('lic](https://x.test/a.png) now')}${finishEvent()}data: [DONE]\n\n`
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    const model = createNewApi({ apiKey: 'sk-test', baseURL: 'https://newapi.test/v1', fetch }).languageModel('image')
    const result = streamText({ model, prompt: 'draw', maxRetries: 0 })
    await result.consumeStream()

    expect(await result.text).toBe('See ![public](https://x.test/a.png) now')
    expect(await result.files).toMatchObject([])
  })

  it('extracts two data images delivered in one delta', async () => {
    const content = `![a](${INLINE_PNG}) and ![b](${INLINE_PNG})`
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(content))
    const model = createNewApi({ apiKey: 'sk-test', baseURL: 'https://newapi.test/v1', fetch }).languageModel('image')

    const result = await model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'draw' }] }] })

    expect(result.content).toMatchObject([
      { type: 'text', text: ' and ' },
      { type: 'file', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
      { type: 'file', mediaType: 'image/png', data: 'iVBORw0KGgo=' }
    ])
  })

  it('extracts back-to-back data images that share one set of SSE deltas', async () => {
    // The second image starts while the first is still held, so the payload scan must not
    // resume from the previous hold boundary.
    const markdown = `![a](${INLINE_PNG})![b](${INLINE_PNG})`
    const body = `${[...markdown].map(event).join('')}${event(' done')}${finishEvent()}data: [DONE]\n\n`
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    const model = createNewApi({ apiKey: 'sk-test', baseURL: 'https://newapi.test/v1', fetch }).languageModel('image')
    const result = streamText({ model, prompt: 'draw', maxRetries: 0 })
    await result.consumeStream()

    expect(await result.text).toBe(' done')
    expect(await result.files).toMatchObject([
      { mediaType: 'image/png', base64: 'iVBORw0KGgo=' },
      { mediaType: 'image/png', base64: 'iVBORw0KGgo=' }
    ])
  })

  it('extracts a line-wrapped base64 payload without whitespace', async () => {
    const wrapped = `${INLINE_PNG.slice(0, 22)}
      ${INLINE_PNG.slice(22)}`
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(`![result](${wrapped})`))
    const model = createNewApi({ apiKey: 'sk-test', baseURL: 'https://newapi.test/v1', fetch }).languageModel('image')

    const result = await model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'draw' }] }] })

    expect(result.content).toMatchObject([{ type: 'file', mediaType: 'image/png', data: 'iVBORw0KGgo=' }])
  })

  it('drops the upstream transfer headers from the rewritten response', async () => {
    const body = JSON.stringify({
      id: 'chatcmpl-image',
      choices: [{ message: { role: 'assistant', content: `![result](${INLINE_PNG})` } }]
    })
    const upstream = new Response(body, {
      headers: {
        'content-type': 'application/json',
        'content-length': String(body.length),
        'content-encoding': 'gzip'
      }
    })

    const rewritten = await normalizeNewApiDataImages(upstream)

    expect(rewritten.headers.has('content-length')).toBe(false)
    expect(rewritten.headers.has('content-encoding')).toBe(false)
    expect(await rewritten.json()).toMatchObject({
      choices: [
        {
          message: {
            content: '',
            images: [{ type: 'image_url', image_url: { url: INLINE_PNG } }]
          }
        }
      ]
    })
  })

  it('leaves a response without data images untouched', async () => {
    const original = jsonResponse('Plain reply')
    const rewritten = await normalizeNewApiDataImages(original)

    expect(await rewritten.text()).toBe(JSON.stringify(JSON.parse(await jsonResponse('Plain reply').text())))
  })
})
