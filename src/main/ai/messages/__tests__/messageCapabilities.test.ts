import type { ModelMessage, UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { MODALITY } from '@cherrystudio/provider-registry'
import type { Model } from '@shared/data/types/model'

import {
  gateToolResultMedia,
  resolveMediaCapabilities,
  resolveToolResultMediaCapabilities,
  routeToolResultMedia,
  stripUnsupportedMedia
} from '../messageCapabilities'

const model = (inputModalities: string[]): Model => ({ capabilities: [], inputModalities }) as unknown as Model

const fileMsg = (mediaType: string): UIMessage => ({
  id: 'm',
  role: 'user',
  parts: [{ type: 'file', mediaType, url: 'data:application/octet-stream;base64,AA' }]
})

describe('resolveMediaCapabilities', () => {
  it('derives modality flags from the model', () => {
    expect(resolveMediaCapabilities(model([MODALITY.IMAGE]))).toEqual({ image: true, video: false, audio: false })
    expect(resolveMediaCapabilities(model([]))).toEqual({ image: false, video: false, audio: false })
  })
})

describe('stripUnsupportedMedia', () => {
  const noVision = { image: false, video: true, audio: true }

  it('leaves image routing to prepareChatMessages', () => {
    const msg = fileMsg('image/png')
    expect(stripUnsupportedMedia([msg], noVision)[0]).toBe(msg)
  })

  it('replaces a video file part when the model has no video', () => {
    const [out] = stripUnsupportedMedia([fileMsg('video/mp4')], { image: true, video: false, audio: true })
    expect(out.parts).toEqual([{ type: 'text', text: expect.stringContaining('video attachment omitted') }])
  })

  it('replaces an audio file part when the model has no audio', () => {
    const [out] = stripUnsupportedMedia([fileMsg('audio/mpeg')], { image: true, video: true, audio: false })
    expect(out.parts).toEqual([{ type: 'text', text: expect.stringContaining('audio attachment omitted') }])
  })

  it('leaves the part untouched when the modality is supported (same reference)', () => {
    const msg = fileMsg('image/png')
    expect(stripUnsupportedMedia([msg], { image: true, video: true, audio: true })[0]).toBe(msg)
  })

  it('leaves non-gated files (e.g. PDF) untouched', () => {
    const msg = fileMsg('application/pdf')
    expect(stripUnsupportedMedia([msg], noVision)[0]).toBe(msg)
  })

  it('replaces only the unsupported part, keeping the rest', () => {
    const msg = {
      id: 'm',
      role: 'user',
      parts: [
        { type: 'text', text: 'hi' },
        { type: 'file', mediaType: 'video/mp4', url: 'data:application/octet-stream;base64,AA' }
      ]
    } as UIMessage
    const [out] = stripUnsupportedMedia([msg], { image: false, video: false, audio: true })
    expect(out.parts).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'text', text: expect.stringContaining('video attachment omitted') }
    ])
  })
})

describe('gateToolResultMedia', () => {
  const ALL = { image: true, video: true, audio: true }
  const NO_VISION = { image: false, video: true, audio: true }
  const imageOutput = {
    type: 'content',
    value: [
      { type: 'text', text: 'x' },
      { type: 'image-data', data: 'AA', mediaType: 'image/png' }
    ]
  }
  const toolMsg = (output: unknown): ModelMessage =>
    ({ role: 'tool', content: [{ type: 'tool-result', toolCallId: 't', toolName: 'shot', output }] }) as ModelMessage

  it('keeps image items untouched for a vision-capable model (same reference)', () => {
    const msg = toolMsg(imageOutput)
    expect(gateToolResultMedia([msg], ALL)[0]).toBe(msg)
  })

  it('replaces image items with a note for a non-vision model, keeping text', () => {
    const out = gateToolResultMedia([toolMsg(imageOutput)], NO_VISION)
    const value = (out[0] as unknown as { content: { output: { value: { type: string; text?: string }[] } }[] })
      .content[0].output.value
    expect(value[0]).toEqual({ type: 'text', text: 'x' })
    expect(value[1]).toMatchObject({ type: 'text' })
    expect(value[1].text).toContain('image attachment omitted')
    expect(JSON.stringify(out)).not.toContain('image-data')
  })

  it('leaves non-tool messages and text-only outputs untouched (same reference)', () => {
    const textToolMsg = toolMsg({ type: 'text', value: 'hello' })
    expect(gateToolResultMedia([textToolMsg], NO_VISION)[0]).toBe(textToolMsg)
    const userMsg = { role: 'user', content: 'hi' } as ModelMessage
    expect(gateToolResultMedia([userMsg], NO_VISION)[0]).toBe(userMsg)
  })
})

describe('resolveToolResultMediaCapabilities', () => {
  const caps = { image: true, video: true, audio: true }

  it('zeroes tool-result media on openai/ollama wires (no media slot in tool messages)', () => {
    expect(resolveToolResultMediaCapabilities(caps, 'openai')).toEqual({ image: false, video: false, audio: false })
    expect(resolveToolResultMediaCapabilities(caps, 'ollama')).toEqual({ image: false, video: false, audio: false })
  })

  it('passes the model caps through on anthropic/google wires (same reference)', () => {
    expect(resolveToolResultMediaCapabilities(caps, 'anthropic')).toBe(caps)
    expect(resolveToolResultMediaCapabilities(caps, 'google')).toBe(caps)
  })
})

describe('routeToolResultMedia', () => {
  const VISION = { image: true, video: false, audio: false }
  const NO_TOOL_MEDIA = { image: false, video: false, audio: false }
  const imageToolMessage = (toolCallId: string): ModelMessage => ({
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId,
        toolName: 'mcp_resource_read',
        output: {
          type: 'content',
          value: [
            { type: 'text', text: 'saved to /tmp/image.png' },
            { type: 'image-data', data: 'BASE64', mediaType: 'image/png' }
          ]
        }
      }
    ]
  })

  it('relocates an image after the complete tool-result run when the model sees images but its wire cannot', () => {
    const routed = routeToolResultMedia(
      [imageToolMessage('one'), imageToolMessage('two'), { role: 'assistant', content: 'continue' }],
      VISION,
      NO_TOOL_MEDIA
    )

    expect(routed.map((message) => message.role)).toEqual(['tool', 'tool', 'user', 'assistant'])
    expect(JSON.stringify(routed.slice(0, 2))).not.toContain('image-data')
    expect(routed[2]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '[tool-result attachment call_id="one" image=1]' },
        { type: 'image', image: 'BASE64', mediaType: 'image/png' },
        { type: 'text', text: '[tool-result attachment call_id="two" image=1]' },
        { type: 'image', image: 'BASE64', mediaType: 'image/png' }
      ]
    })
  })

  it('keeps native tool-result images on a capable wire and omits them for a non-vision model', () => {
    const message = imageToolMessage('one')
    expect(routeToolResultMedia([message], VISION, VISION)[0]).toBe(message)

    const withoutVision = routeToolResultMedia([message], NO_TOOL_MEDIA, NO_TOOL_MEDIA)
    expect(JSON.stringify(withoutVision)).not.toContain('image-data')
    expect(withoutVision).toHaveLength(1)
  })
})
