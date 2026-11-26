import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createVertexMaas } from '@ai-sdk/google-vertex/maas'
import { generateText, type LanguageModelMiddleware, wrapLanguageModel } from 'ai'
import { expect, it } from 'vitest'

import type { AiRequestContext } from '@cherrystudio/ai-core'
import { makeModel } from '@main/ai/__tests__/fixtures'
import { toModelMessages } from '@main/ai/messages/messageRules'
import { captureWithFetch } from '@main/ai/provider/custom/__tests__/boundary/captureRequest'
import { collectFromFeatures } from '@main/ai/runtime/aiSdk/params/collectFromFeatures'
import { INTERNAL_FEATURES } from '@main/ai/runtime/aiSdk/params/features/internalFeatures'
import type { RequestScope } from '@main/ai/runtime/aiSdk/params/scope'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { GeminiMessageConverter } from '../adapters/converters/GeminiMessageConverter'

const signed = { text: '\n \t', thoughtSignature: 'c2lnbmF0dXJl' }
const answer = { text: 'Answer.' }

it.each([
  { providerId: 'google', sourceRoute: undefined, replaysSignature: true },
  { providerId: 'google', sourceRoute: 'fixture-route', replaysSignature: true },
  { providerId: 'google', sourceRoute: 'other-route', replaysSignature: false },
  { providerId: 'anthropic', sourceRoute: undefined, replaysSignature: false },
  { providerId: 'google-vertex-maas', sourceRoute: undefined, replaysSignature: false }
] as const)(
  'replays only a compatible signed part for $providerId (source $sourceRoute)',
  async ({ providerId, sourceRoute, replaysSignature }) => {
    const history = new GeminiMessageConverter().toUIMessages({
      contents: [
        { role: 'user', parts: [{ text: 'Question?' }] },
        { role: 'model', parts: [signed, { text: '\t' }, answer] },
        { role: 'user', parts: [{ text: 'Continue.' }] }
      ]
    })
    const signedPart = history[1]?.parts[0]
    if (sourceRoute && signedPart?.type === 'text') {
      signedPart.providerMetadata = { ...signedPart.providerMetadata, cherry: { replayRouteId: sourceRoute } }
    }
    const modelId = 'fixture'
    const scope = {
      replayRouteId: 'fixture-route',
      request: { contextOwner: sourceRoute ? undefined : 'caller', messages: history },
      model: makeModel({ apiModelId: modelId }),
      endpointType:
        providerId === 'anthropic' ? ENDPOINT_TYPE.ANTHROPIC_MESSAGES : ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
      sdkConfig: { providerId, modelId }
    } as RequestScope
    const middlewares: LanguageModelMiddleware[] = []
    const features = INTERNAL_FEATURES.filter((feature) => feature.name === 'conversation-state-replay')
    for (const plugin of collectFromFeatures(scope, features).modelAdapters) {
      await plugin.configureContext?.({ middlewares } as AiRequestContext)
    }

    const messages = await toModelMessages(history, undefined, undefined, undefined, {
      preserveSignedGeminiWhitespace: true
    })
    const { body } = await captureWithFetch((fetch) => {
      const options = { baseURL: 'https://fixture.invalid', apiKey: 'test', fetch }
      const model = {
        google: () => createGoogleGenerativeAI(options)(modelId),
        anthropic: () => createAnthropic(options)(modelId),
        'google-vertex-maas': () =>
          createVertexMaas({
            ...options,
            googleAuthOptions: {
              authClient: { getAccessToken: async () => ({ token: 'fixture-token' }) } as NonNullable<
                NonNullable<Parameters<typeof createVertexMaas>[0]>['googleAuthOptions']
              >['authClient']
            }
          })(modelId)
      }[providerId]
      return generateText({
        model: wrapLanguageModel({ model: model(), middleware: middlewares }),
        messages,
        maxRetries: 0
      })
    })

    if (providerId === 'google') {
      const parts = replaysSignature ? [signed, answer] : [answer]
      expect(body).toMatchObject({ contents: [{}, { role: 'model', parts }, {}] })
    } else {
      const content = providerId === 'anthropic' ? [{ type: 'text', text: answer.text }] : answer.text
      expect(body).toMatchObject({ messages: [{}, { role: 'assistant', content }, {}] })
    }
  }
)
