import { createGateway } from '@ai-sdk/gateway'
import type { ImageModelV3, ImageModelV3CallOptions } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'

import { splitParamValues } from '../../../utils/imageOptions'
import { createGatewayWithImageModel } from '../gateway/gatewayProvider'
import { buildVendorProviderOptions } from '../wire/buildImageRequest'
import { DEFAULT_DIFFUSION_REGISTRATION, WIRE_REGISTRY } from '../wire/wireProfile'

const callOptions = (providerOptions: unknown): ImageModelV3CallOptions => ({
  prompt: 'a fox',
  n: 1,
  size: '1536x864',
  aspectRatio: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerOptions: providerOptions as ImageModelV3CallOptions['providerOptions']
})

function builderOptions(params: Record<string, unknown>) {
  const { structured, vendorBag } = splitParamValues(params)
  const registration = WIRE_REGISTRY.gateway ?? DEFAULT_DIFFUSION_REGISTRATION
  return { structured, providerOptions: buildVendorProviderOptions('gateway', params, registration, vendorBag) }
}

function captureGateway() {
  const requests: { url: string; init: RequestInit; body: Record<string, any> }[] = []
  const provider = createGatewayWithImageModel({
    apiKey: 'test-key',
    baseURL: 'https://gateway.test/v1/ai',
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init!, body: JSON.parse(init!.body as string) })
      return new Response(JSON.stringify({ images: ['QUJD'] }), { headers: { 'content-type': 'application/json' } })
    }
  })
  return { provider, requests }
}

describe('Gateway image request envelope', () => {
  for (const modelId of ['openai/gpt-image-2.5-flare', 'openai/gpt-image-2.5-sunburst']) {
    for (const quality of ['low', 'high']) {
      it.each(['imageModel', 'image'] as const)(`${modelId} ${quality} via %s`, async (entryPoint) => {
        const params = { quality, size: '1536x864', numImages: 1 }
        const { structured, vendorBag } = splitParamValues(params)
        Object.assign(vendorBag, { only: ['openai'], zeroDataRetention: true })
        const registration = WIRE_REGISTRY.gateway ?? DEFAULT_DIFFUSION_REGISTRATION
        const providerOptions = buildVendorProviderOptions('gateway', params, registration, vendorBag)
        const { provider, requests } = captureGateway()

        await provider[entryPoint](modelId).doGenerate({
          ...callOptions(providerOptions),
          n: structured.n!,
          size: structured.size as ImageModelV3CallOptions['size']
        })

        const { url, init, body } = requests[0]
        expect(url).toBe('https://gateway.test/v1/ai/image-model')
        expect(init.method).toBe('POST')
        expect(new Headers(init.headers).get('ai-model-id')).toBe(modelId)
        expect(body).toEqual({
          prompt: 'a fox',
          n: 1,
          size: '1536x864',
          providerOptions: {
            gateway: { only: ['openai'], zeroDataRetention: true },
            openai: { quality }
          }
        })
        expect(body.providerOptions.gateway).not.toHaveProperty('quality')
        expect(body.providerOptions.openai).not.toHaveProperty('only')
        expect(body.providerOptions.openai).not.toHaveProperty('zeroDataRetention')
        expect(body.providerOptions.openai).not.toHaveProperty('size')
        expect(body.size).toBe('1536x864')
      })
    }
  }

  it.each([
    'gpt-image-1',
    'gpt-image-1.5',
    'gpt-image-1-mini',
    'gpt-image-2',
    'gpt-image-2.5-flare',
    'gpt-image-2.5-sunburst'
  ])('normalizes quality for openai/%s and removes an exhausted gateway namespace', async (id) => {
    const { provider, requests } = captureGateway()
    await provider.imageModel(`openai/${id}`).doGenerate(callOptions({ gateway: { quality: 'low' } }))
    expect(requests[0].body.providerOptions).toEqual({ openai: { quality: 'low' } })
  })

  it('moves all six fields verbatim while preserving explicit OpenAI values and other namespaces', async () => {
    const fields = {
      quality: 'low',
      background: 'auto',
      moderation: 'low',
      style: 'vivid',
      outputFormat: 'png',
      outputCompression: 0
    }
    const providerOptions = Object.freeze({
      gateway: Object.freeze({
        ...fields,
        user: 'user',
        only: ['openai'],
        zeroDataRetention: true,
        extra: { keep: true }
      }),
      openai: Object.freeze({ quality: 'high', extra: 'keep' }),
      sibling: Object.freeze({ quality: 'untouched' })
    })
    const { provider, requests } = captureGateway()
    const model = provider.imageModel('openai/gpt-image-1')
    await model.doGenerate(callOptions(providerOptions))
    const expected = {
      gateway: { user: 'user', only: ['openai'], zeroDataRetention: true, extra: { keep: true } },
      openai: { ...fields, quality: 'high', extra: 'keep' },
      sibling: { quality: 'untouched' }
    }
    expect(requests[0].body.providerOptions).toEqual(expected)
    expect(providerOptions.gateway).toEqual({ ...fields, ...expected.gateway })
    expect(providerOptions.openai).toEqual({ quality: 'high', extra: 'keep' })
    await model.doGenerate(callOptions(expected))
    expect(requests[1].body.providerOptions).toEqual(expected)
  })

  it.each([
    { gateway: { only: ['openai'], zeroDataRetention: true } },
    { openai: { quality: 'high' } },
    {},
    { gateway: {}, openai: {} }
  ])('preserves options with nothing to migrate: %j', async (providerOptions) => {
    const { provider, requests } = captureGateway()
    await provider.imageModel('openai/gpt-image-1').doGenerate(callOptions(providerOptions))
    expect(requests[0].body.providerOptions).toEqual(providerOptions)
  })

  it.each([
    'google/gemini-3-pro-preview',
    'google/gpt-image-1',
    'gpt-image-1',
    'anthropic/image',
    'sakana/image',
    'OpenAI/gpt-image-1'
  ])('does not infer OpenAI ownership for %s', async (modelId) => {
    const providerOptions = { gateway: { quality: 'low', only: ['google'] }, openai: { style: 'natural' } }
    const { provider, requests } = captureGateway()
    await provider.imageModel(modelId).doGenerate(callOptions(providerOptions))
    expect(requests[0].body.providerOptions).toEqual(providerOptions)
  })

  it('preserves every other image parameter while normalizing options', async () => {
    const { provider, requests } = captureGateway()
    const abortSignal = new AbortController().signal
    const files: ImageModelV3CallOptions['files'] = [{ type: 'file', mediaType: 'image/png', data: 'SU5QVVQ=' }]
    const mask: ImageModelV3CallOptions['mask'] = { type: 'file', mediaType: 'image/png', data: 'TUFTSw==' }
    await provider.imageModel('openai/gpt-image-1').doGenerate({
      ...callOptions({ gateway: { quality: 'low' } }),
      prompt: 'edit a fox',
      n: 2,
      aspectRatio: '16:9',
      seed: 42,
      files,
      mask,
      headers: { 'x-test-image': 'preserved' },
      abortSignal
    })
    expect(requests[0].body).toEqual({
      prompt: 'edit a fox',
      n: 2,
      size: '1536x864',
      aspectRatio: '16:9',
      seed: 42,
      files,
      mask,
      providerOptions: { openai: { quality: 'low' } }
    })
    expect(new Headers(requests[0].init.headers).get('x-test-image')).toBe('preserved')
    expect(requests[0].init.signal).toBe(abortSignal)
  })

  it('returns the original parameters when migration is inapplicable or containers are malformed', async () => {
    const prototype = Object.getPrototypeOf(createGateway({ apiKey: 'test-key' }).imageModel('openai/gpt-image-1'))
    let received: ImageModelV3CallOptions | undefined
    const generate = vi.spyOn(prototype, 'doGenerate').mockImplementation(async (...args: unknown[]) => {
      received = args[0] as ImageModelV3CallOptions
      return {
        images: ['QUJD'],
        warnings: [],
        response: { timestamp: new Date(), modelId: 'openai/gpt-image-1', headers: undefined }
      } satisfies Awaited<ReturnType<ImageModelV3['doGenerate']>>
    })
    try {
      const { provider } = captureGateway()
      const unchanged: unknown[] = [
        undefined,
        {},
        { gateway: {} },
        { openai: { quality: 'high' } },
        { gateway: { only: ['openai'] } }
      ]
      for (const malformed of [null, [], 'invalid', 42, new Date()]) {
        unchanged.push(malformed, { gateway: malformed }, { gateway: { quality: 'low' }, openai: malformed })
      }
      for (const providerOptions of unchanged) {
        const params = callOptions(providerOptions)
        await provider.imageModel('openai/gpt-image-1').doGenerate(params)
        expect(received).toBe(params)
        expect(received?.providerOptions).toBe(providerOptions)
      }
    } finally {
      generate.mockRestore()
    }
  })

  it('migrates own fields even when non-enumerable', async () => {
    const gateway = Object.defineProperty({}, 'quality', { value: 'low' })
    const { provider, requests } = captureGateway()
    await provider.imageModel('openai/gpt-image-1').doGenerate(callOptions({ gateway }))
    expect(requests[0].body.providerOptions).toEqual({ openai: { quality: 'low' } })
    expect(gateway).toHaveProperty('quality', 'low')
  })

  it('keeps builder-omitted auto quality omitted', async () => {
    const { providerOptions } = builderOptions({ quality: 'auto' })
    expect(providerOptions).toEqual({})
    const { provider, requests } = captureGateway()
    await provider.imageModel('openai/gpt-image-1').doGenerate(callOptions(providerOptions))
    expect(requests[0].body.providerOptions).toEqual({})
  })

  for (const malformed of [null, [], 'invalid', 42]) {
    it.each([malformed, { gateway: malformed }, { gateway: { quality: 'low' }, openai: malformed }])(
      'passes malformed containers through without throwing: %j',
      async (providerOptions) => {
        const { provider, requests } = captureGateway()
        await provider.imageModel('openai/gpt-image-1').doGenerate(callOptions(providerOptions))
        if (providerOptions === null) expect(requests[0].body).not.toHaveProperty('providerOptions')
        else expect(requests[0].body.providerOptions).toEqual(providerOptions)
      }
    )
  }
})
