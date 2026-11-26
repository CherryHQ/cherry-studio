import type { LanguageModelV3FilePart, LanguageModelV3Message } from '@ai-sdk/provider'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'

import { enforceImagePayloadBudget } from '../imagePayloadBudget'

const signal = new AbortController().signal
const image = (data: LanguageModelV3FilePart['data'], filename = 'scan.jpg') =>
  ({ type: 'file', mediaType: 'image/jpeg', data, filename }) as const
const user = (...content: Extract<LanguageModelV3Message, { role: 'user' }>['content']) =>
  ({ role: 'user', content }) as const

let jpeg: Buffer
beforeAll(async () => {
  jpeg = await sharp({ create: { width: 1600, height: 80, channels: 3, background: '#123456' } })
    .jpeg()
    .toBuffer()
})

describe('Home chat provider prompt image budget', () => {
  it('preserves images at exactly 30 MB of file bytes even when base64 exceeds 30 MB', async () => {
    const part = image(Buffer.concat([jpeg, Buffer.alloc(10_000_000 - jpeg.length)]).toString('base64'))
    const prompt = [user(part, part), user(part)]

    const result = await enforceImagePayloadBudget(prompt, 1, signal)

    expect(result).toEqual({ prompt, reducedCount: 0, omittedCount: 0 })
  })

  it('uses a smaller rung when the first JPEG cannot fit and leaves the coalesced current attachment intact', async () => {
    const earlier = image(Buffer.concat([jpeg, Buffer.alloc(10_000)]))
    const current = image(jpeg, 'new.jpg')
    const message = user({ type: 'text', text: 'Earlier scan' }, earlier, current)
    const firstRung = await sharp(jpeg).resize(1280).jpeg({ quality: 80 }).toBuffer()
    const budget = jpeg.length + firstRung.length - 1

    const result = await enforceImagePayloadBudget([message], 1, signal, budget)

    const [outbound] = result.prompt
    if (outbound.role !== 'user') throw new Error('Expected a user message')
    const [text, reduced, latest] = outbound.content
    if (reduced.type !== 'file' || !(reduced.data instanceof Uint8Array)) throw new Error('Expected a resized image')
    expect(reduced.data.byteLength + jpeg.length).toBeLessThanOrEqual(budget)
    expect(await sharp(reduced.data).metadata()).toMatchObject({ format: 'jpeg', width: 768 })
    expect(text).toEqual({ type: 'text', text: 'Earlier scan' })
    expect(latest).toEqual(current)
    expect(message.content[1]).toEqual(earlier)
    expect(result).toMatchObject({ reducedCount: 1, omittedCount: 0 })
  })

  it('counts an omitted image only once when no JPEG from the ladder fits', async () => {
    const earlier = image(jpeg)
    const current = image(jpeg.subarray(0, jpeg.length - 1), 'new.jpg')

    const result = await enforceImagePayloadBudget([user(earlier), user(current)], 1, signal, jpeg.length)

    expect(result.prompt[0].content).toEqual([
      { type: 'text', text: '[Image "scan.jpg" omitted to fit the chat image budget]' }
    ])
    expect(result.prompt[1].content).toEqual([current])
    expect(result).toMatchObject({ reducedCount: 0, omittedCount: 1 })
  })

  it('keeps a tool result paired and in order when its image is omitted', async () => {
    const call = { type: 'tool-call', toolCallId: 'scan', toolName: 'read', input: {} } as const
    const result = {
      type: 'tool-result',
      toolCallId: 'scan',
      toolName: 'read',
      output: {
        type: 'content',
        value: [
          { type: 'text', text: 'Before' },
          { type: 'file-data', filename: 'tool.jpg', mediaType: 'image/jpeg', data: jpeg.toString('base64') },
          { type: 'text', text: 'After' }
        ]
      }
    } satisfies Extract<LanguageModelV3Message, { role: 'tool' }>['content'][number]
    const prompt: LanguageModelV3Message[] = [
      user({ type: 'text', text: 'Read the scan' }),
      { role: 'assistant', content: [call] },
      { role: 'tool', content: [result] }
    ]

    const outbound = await enforceImagePayloadBudget(prompt, 0, signal, 1)

    expect(outbound).toEqual({
      prompt: [
        prompt[0],
        prompt[1],
        {
          role: 'tool',
          content: [
            {
              ...result,
              output: {
                type: 'content',
                value: [
                  result.output.value[0],
                  { type: 'text', text: '[Image "tool.jpg" omitted to fit the chat image budget]' },
                  result.output.value[2]
                ]
              }
            }
          ]
        }
      ],
      reducedCount: 0,
      omittedCount: 1
    })
    expect(result.output.value[1]).toMatchObject({ type: 'file-data', data: jpeg.toString('base64') })
  })

  it('omits an opaque historical URL and preserves current attachments even if they exceed the budget', async () => {
    const remote = image(new URL('https://example.com/scan.jpg'))
    const current = image(jpeg, 'new.jpg')
    const result = await enforceImagePayloadBudget([user(remote), user(current)], 1, signal, jpeg.length - 1)

    expect(result.prompt[0].content).toEqual([
      { type: 'text', text: '[Image "scan.jpg" omitted to fit the chat image budget]' }
    ])
    expect(result.prompt[1].content).toEqual([current])
    expect(result).toMatchObject({ reducedCount: 0, omittedCount: 1 })
  })

  it('reduces an uppercase DATA: image-url in a tool result within budget', async () => {
    const oversized = Buffer.concat([jpeg, Buffer.alloc(10_000)])
    const call = { type: 'tool-call', toolCallId: 'scan', toolName: 'read', input: {} } as const
    const result = {
      type: 'tool-result',
      toolCallId: 'scan',
      toolName: 'read',
      output: {
        type: 'content',
        value: [{ type: 'image-url', url: `DATA:image/jpeg;base64,${oversized.toString('base64')}` }]
      }
    } satisfies Extract<LanguageModelV3Message, { role: 'tool' }>['content'][number]
    const prompt: LanguageModelV3Message[] = [
      user({ type: 'text', text: 'Read the scan' }),
      { role: 'assistant', content: [call] },
      { role: 'tool', content: [result] }
    ]

    const outbound = await enforceImagePayloadBudget(prompt, 0, signal, oversized.length - 1)
    const toolMessage = outbound.prompt[2]
    if (toolMessage.role !== 'tool') throw new Error('Expected a tool message')
    const toolResult = toolMessage.content[0]
    if (toolResult.type !== 'tool-result' || toolResult.output.type !== 'content') {
      throw new Error('Expected content tool result')
    }
    expect(outbound.reducedCount + outbound.omittedCount).toBe(1)
    expect(toolResult.output.value[0]).not.toMatchObject({ type: 'image-url' })
  })

  it('stops before provider dispatch when cancelled during image preparation', async () => {
    const controller = new AbortController()
    const prompt = [user(image(jpeg)), user({ type: 'text', text: 'Continue' })]
    const pending = enforceImagePayloadBudget(prompt, 0, controller.signal, jpeg.length - 1)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
