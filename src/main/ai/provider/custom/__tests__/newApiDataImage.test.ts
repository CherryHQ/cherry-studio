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

  it.each(['result', 'a!b', 'a![b'])('reassembles a text-prefixed data image with alt %s', async (alt) => {
    const body = `${event(`Here: ![${alt}](data:image/png;base64,iVBO`)}${event('Rw0KGgo=)')}${finishEvent()}data: [DONE]\n\n`
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    const model = createNewApi({ apiKey: 'sk-test', baseURL: 'https://newapi.test/v1', fetch }).languageModel('image')
    const result = streamText({ model, prompt: 'draw', maxRetries: 0 })
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

  it.each(['result', 'a!b', 'a![b', '![long'.repeat(1000)])(
    'handles long and punctuated labels across single-character deltas: %.20s',
    async (alt) => {
      const markdown = `Here: ![${alt}](${INLINE_PNG}) done`
      const body = `${[...markdown].map(event).join('')}${finishEvent()}data: [DONE]\n\n`
      const response = await normalizeNewApiDataImages(
        new Response(body, { headers: { 'content-type': 'text/event-stream' } })
      )
      const choices = (await response.text())
        .split('\n\n')
        .filter((line) => line.startsWith('data: {'))
        .flatMap((line) => JSON.parse(line.slice(6)).choices)

      expect(choices.map((choice) => choice.delta.content ?? '').join('')).toBe('Here:  done')
      expect(choices.flatMap((choice) => choice.delta.images ?? [])).toEqual([
        { type: 'image_url', image_url: { url: INLINE_PNG } }
      ])
    }
  )

  it.each([
    '![unfinished',
    '![result](data:image/png;base64,AAAA',
    `${'!['.repeat(10000)}]x`,
    '![result](data:image/png;base64,invalid?)'
  ])('preserves incomplete or invalid candidates at EOF: %.30s', async (content) => {
    const body = `${event(content.slice(0, 7))}${event(content.slice(7))}`
    const response = await normalizeNewApiDataImages(
      new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    )
    const choices = (await response.text())
      .split('\n\n')
      .filter(Boolean)
      .flatMap((line) => JSON.parse(line.slice(6)).choices)

    expect(choices.map((choice) => choice.delta.content ?? '').join('')).toBe(content)
    expect(choices.flatMap((choice) => choice.delta.images ?? [])).toEqual([])
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

  it('releases buffered ordinary text when the terminal event has no content', async () => {
    const body = `${event('Great!')}${finishEvent()}data: [DONE]\n\n`
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    const model = createNewApi({ apiKey: 'sk-test', baseURL: 'https://newapi.test/v1', fetch }).languageModel('image')
    const result = streamText({ model, prompt: 'hello', maxRetries: 0 })
    await result.consumeStream()

    expect(await result.text).toBe('Great!')
    expect(await result.files).toMatchObject([])
  })

  it.each([['Great! Have a nice day.'], ['Great!', ' Have a nice day.']])(
    'releases ordinary exclamations before the stream finishes: %j',
    async (...deltas) => {
      const encoder = new TextEncoder()
      const response = await normalizeNewApiDataImages(
        new Response(
          new ReadableStream({
            start(controller) {
              for (const delta of deltas) controller.enqueue(encoder.encode(event(delta)))
            }
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        )
      )
      const reader = response.body!.getReader()
      let text = ''
      try {
        for (let index = 0; index < deltas.length; index++) {
          const { value } = await reader.read()
          const data = new TextDecoder().decode(value).slice('data: '.length).trim()
          text += JSON.parse(data).choices[0].delta.content
        }
        expect(text).toBe('Great! Have a nice day.')
      } finally {
        await reader.cancel()
      }
    }
  )

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

  it.each(['!!', '![bad](', '![bad](data:image/png;base64,?'])(
    'recovers from a rejected candidate before another image: %s',
    async (prefix) => {
      const markdown = `${prefix}![good](${INLINE_PNG}) done`
      for (let split = 0; split <= markdown.length; split++) {
        const body = `${event(markdown.slice(0, split))}${event(markdown.slice(split))}${finishEvent()}data: [DONE]\n\n`
        const response = await normalizeNewApiDataImages(
          new Response(body, { headers: { 'content-type': 'text/event-stream' } })
        )
        const choices = (await response.text())
          .split('\n\n')
          .filter((line) => line.startsWith('data: {'))
          .flatMap((line) => JSON.parse(line.slice(6)).choices)

        expect(choices.map((choice) => choice.delta.content ?? '').join('')).toBe(`${prefix} done`)
        expect(choices.flatMap((choice) => choice.delta.images ?? [])).toEqual([
          { type: 'image_url', image_url: { url: INLINE_PNG } }
        ])
      }
    }
  )

  it('extracts a line-wrapped base64 payload without whitespace', async () => {
    const wrapped = `${INLINE_PNG.slice(0, 22)}
      ${INLINE_PNG.slice(22)}`
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(`![result](${wrapped})`))
    const model = createNewApi({ apiKey: 'sk-test', baseURL: 'https://newapi.test/v1', fetch }).languageModel('image')

    const result = await model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'draw' }] }] })

    expect(result.content).toMatchObject([{ type: 'file', mediaType: 'image/png', data: 'iVBORw0KGgo=' }])
  })

  it('reassembles a large payload from many small deltas without exposing base64 text', async () => {
    const payload = 'AAAA'.repeat(65536)
    const deltas = ['Here: ![result](data:image/png;base64,']
    for (let index = 0; index < payload.length; index += 64) deltas.push(payload.slice(index, index + 64))
    deltas.push(') done')
    const body = `${deltas.map(event).join('')}${finishEvent()}data: [DONE]\n\n`
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    const model = createNewApi({ apiKey: 'sk-test', baseURL: 'https://newapi.test/v1', fetch }).languageModel('image')
    const result = streamText({ model, prompt: 'draw', maxRetries: 0 })
    await result.consumeStream()

    expect(await result.text).toBe('Here:  done')
    expect(await result.files).toMatchObject([{ mediaType: 'image/png', base64: payload }])
  })

  it('keeps pending images isolated by choice and preserves existing images', async () => {
    const image = { type: 'image_url', image_url: { url: 'https://x.test/existing.png' } }
    const chunks = [
      { choices: [{ index: 0, delta: { content: '![a](data:image/png;base64,iVBO' } }] },
      { choices: [{ index: 1, delta: { content: 'Other choice!' } }] },
      { choices: [{ index: 0, delta: { content: 'Rw0KGgo=)', images: [image] }, finish_reason: 'stop' }] },
      { choices: [{ index: 1, delta: {}, finish_reason: 'stop' }] }
    ]
    const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`
    const response = await normalizeNewApiDataImages(
      new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    )
    const choices = (await response.text())
      .split('\n\n')
      .filter((line) => line.startsWith('data: {'))
      .flatMap((line) => JSON.parse(line.slice(6)).choices)

    expect(
      choices
        .filter((choice) => choice.index === 1)
        .map((choice) => choice.delta.content)
        .join('')
    ).toBe('Other choice!')
    expect(choices.filter((choice) => choice.index === 0).flatMap((choice) => choice.delta.images ?? [])).toEqual([
      image,
      { type: 'image_url', image_url: { url: INLINE_PNG } }
    ])
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
