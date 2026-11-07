import type { LanguageModelV3 } from '@ai-sdk/provider'
import { streamText, type UIMessage, wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'

import type { AiRequestContext } from '@cherrystudio/ai-core'

import { createIllustrationInputsPlugin, prepareIllustrationInputs } from '../illustrationInputs'
import { toModelMessages } from '../messageRules'

describe('illustration input selection', () => {
  it('labels only user images still present in the prepared request, with unambiguous ordered references', () => {
    const image = (id: string) => ({
      type: 'file' as const,
      filename: 'photo.png',
      mediaType: 'image/png',
      url: 'data:image/png;base64,AQID',
      providerMetadata: { cherry: { fileEntryId: id } }
    })
    const messages: UIMessage[] = [
      { id: 'old-summary', role: 'user', parts: [{ type: 'text', text: 'Previously attached photo.png' }] },
      { id: 'old', role: 'user', parts: [image('first')] },
      { id: 'assistant', role: 'assistant', parts: [image('generated')] },
      {
        id: 'current',
        role: 'user',
        parts: [
          { type: 'text', text: 'Put the first person in the second scene' },
          image('second'),
          image('first'),
          { type: 'file', filename: 'readme.txt', mediaType: 'text/plain', url: 'data:text/plain;base64,QQ==' }
        ]
      }
    ]

    const prepared = prepareIllustrationInputs(messages)

    expect(prepared.inputs).toEqual([
      { reference: 'image_1', id: 'first', name: 'photo.png' },
      { reference: 'image_2', id: 'second', name: 'photo.png' }
    ])
    expect(prepared.messages[1].parts).toMatchObject([
      { type: 'text', text: expect.stringContaining('image_1') },
      image('first')
    ])
    expect(prepared.messages[3].parts).toMatchObject([
      { type: 'text', text: 'Put the first person in the second scene' },
      { type: 'text', text: expect.stringContaining('image_2') },
      image('second'),
      { type: 'text', text: expect.stringContaining('image_1') },
      image('first'),
      { type: 'file', mediaType: 'text/plain' }
    ])
    expect(messages[1].parts).toEqual([image('first')])
    expect(prepared.messages[2]).toEqual(messages[2])
  })

  // Catches authorizing a compressed-away image just because its filename or label survived in a summary.
  it('authorizes only user images that survive the final context middleware', async () => {
    const selected: string[][] = []
    const plugin = createIllustrationInputsPlugin(
      () => [
        { reference: 'image_1', id: 'removed', name: 'old.png' },
        { reference: 'image_2', id: 'visible', name: 'current.png' }
      ],
      (inputs) => selected.push(inputs.map((input) => input.id))
    )
    const context: AiRequestContext = {
      providerId: 'openai',
      model: 'test',
      originalParams: {},
      metadata: {},
      startTime: 0,
      requestId: 'test',
      recursiveCall: async () => ({}),
      isRecursiveCall: false,
      recursiveDepth: 0,
      maxRecursiveDepth: 10,
      extensions: new Map(),
      middlewares: []
    }
    await plugin.configureContext?.(context)
    const messages = await toModelMessages([
      { id: 'summary', role: 'user', parts: [{ type: 'text', text: 'Illustration reference image_1: old.png' }] },
      {
        id: 'current',
        role: 'user',
        parts: [
          {
            type: 'file',
            mediaType: 'image/png',
            url: 'data:image/png;base64,AQID',
            providerMetadata: { cherry: { fileEntryId: 'visible' } }
          }
        ]
      }
    ])
    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'test',
      modelId: 'test',
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error('Unused')
      },
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.close()
          }
        })
      })
    }
    await streamText({
      model: wrapLanguageModel({ model, middleware: context.middlewares! }),
      messages
    }).consumeStream()
    expect(selected).toEqual([['visible']])
  })
})
