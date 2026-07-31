/**
 * Registry `serverTools` declarations vs runtime delivery.
 *
 * A declaration makes `resolveWebToolRoutes` route the capability to the
 * server side, which withholds the client tools — so a declaration without a
 * working delivery path injects NOTHING (silent no-op). Every declared
 * (provider, tool) pair must state its delivery here; factory-backed ones are
 * verified against the extension registry for real.
 */

import fs from 'node:fs'
import path from 'node:path'

import { extensionRegistry, type ToolCapability } from '@cherrystudio/ai-core/provider'
import { describe, expect, it } from 'vitest'

import { extensions } from '../extensions'

// Same idempotent registration as `provider/factory.ts`, without importing its
// heavier dependency graph.
for (const extension of extensions) {
  if (!extensionRegistry.has(extension.config.name)) {
    extensionRegistry.register(extension)
  }
}

type Delivery =
  /** providerToolPlugin resolves these extension toolFactories. */
  | { kind: 'factories'; names: string[] }
  /** Delivered as plain provider options (`getWebSearchParams`), no factory involved. */
  | { kind: 'provider-options' }
  /** The model searches unconditionally; no request mutation needed. */
  | { kind: 'implicit' }
  /** Gateway resolves to another row's factories via model/endpoint mapping. */
  | { kind: 'gateway-mapped' }

const factories = (...names: string[]): Delivery => ({ kind: 'factories', names })

const DELIVERY: Record<string, Partial<Record<string, Delivery>>> = {
  anthropic: { 'web-search': factories('anthropic'), 'url-context': factories('anthropic') },
  gemini: { 'web-search': factories('google'), 'url-context': factories('google') },
  vertexai: {
    'web-search': factories('google-vertex', 'google-vertex-anthropic'),
    // Declared `vendors: ['gemini']`: @ai-sdk/google-vertex/anthropic exposes
    // no webFetch tool, so availability itself excludes Claude-on-Vertex.
    'url-context': factories('google-vertex')
  },
  'aws-bedrock': { 'web-search': factories('bedrock'), 'url-context': factories('bedrock') },
  'azure-openai': {
    'web-search': factories('azure', 'azure-responses', 'azure-anthropic'),
    'url-context': factories('azure-anthropic')
  },
  openai: { 'web-search': factories('openai', 'openai-chat') },
  grok: { 'web-search': factories('xai-responses') },
  openrouter: { 'web-search': factories('openrouter') },
  perplexity: { 'web-search': { kind: 'implicit' } },
  // Responses-endpoint models only; the openai extension's factory emits the bare tool shape.
  doubao: { 'web-search': factories('openai') },
  dashscope: { 'web-search': { kind: 'provider-options' } },
  // web_search marker via providerOptions, moved into `tools` by transformZhipuRequestBody.
  zhipu: { 'web-search': { kind: 'provider-options' } },
  // $web_search echo tool injected by the moonshot extension factory.
  moonshot: { 'web-search': factories('moonshot') },
  poe: { 'web-search': { kind: 'provider-options' } },
  gateway: { 'web-search': { kind: 'gateway-mapped' } },
  cherryin: { 'web-search': { kind: 'gateway-mapped' }, 'url-context': { kind: 'gateway-mapped' } },
  'new-api': { 'web-search': { kind: 'gateway-mapped' }, 'url-context': { kind: 'gateway-mapped' } },
  // Native vendor endpoints behind `aihubmix.<vendor>` model provider strings.
  aihubmix: { 'web-search': { kind: 'gateway-mapped' }, 'url-context': { kind: 'gateway-mapped' } },
  // Anthropic-direct (anthropic-messages endpoint, adapterFamily 'anthropic').
  'claude-code': { 'url-context': factories('anthropic') }
}

const CAPABILITY: Record<string, ToolCapability> = {
  'web-search': 'webSearch',
  'url-context': 'urlContext'
}

const providers: Array<{ id: string; serverTools?: Array<{ id: string; vendors?: string[] }> }> = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'packages/provider-registry/data/providers.json'), 'utf8')
).providers

const declared = providers
  .filter((provider) => provider.serverTools?.length)
  .flatMap((provider) =>
    provider.serverTools!.map((tool) => ({ providerId: provider.id, toolId: tool.id, vendors: tool.vendors }))
  )

describe('registry serverTools declarations have a runtime delivery path', () => {
  it('covers every declared (provider, tool) pair in the delivery table', () => {
    const uncovered = declared.filter(({ providerId, toolId }) => DELIVERY[providerId]?.[toolId] === undefined)
    expect(uncovered).toEqual([])
  })

  it('has no stale delivery entries without a matching declaration', () => {
    const declaredKeys = new Set(declared.map(({ providerId, toolId }) => `${providerId}/${toolId}`))
    const stale = Object.entries(DELIVERY).flatMap(([providerId, tools]) =>
      Object.keys(tools).filter((toolId) => !declaredKeys.has(`${providerId}/${toolId}`))
    )
    expect(stale).toEqual([])
  })

  it.each(
    Object.entries(DELIVERY).flatMap(([providerId, tools]) =>
      Object.entries(tools)
        .filter((entry): entry is [string, Delivery & { kind: 'factories' }] => entry[1]?.kind === 'factories')
        .flatMap(([toolId, delivery]) => delivery.names.map((extensionName) => ({ providerId, toolId, extensionName })))
    )
  )('$providerId $toolId resolves a $extensionName toolFactory', ({ toolId, extensionName }) => {
    expect(extensionRegistry.getToolFactory(extensionName, CAPABILITY[toolId])).toBeDefined()
  })

  // A gateway delivers the underlying vendor's native tool, so a model whose
  // vendor owns no factory injects nothing while the client tools stay withheld.
  // `vendors` is what keeps such a model off the server route (and off the tag).
  it('narrows every gateway-mapped declaration to servable vendors', () => {
    const unnarrowed = declared
      .filter(({ providerId, toolId }) => DELIVERY[providerId]?.[toolId]?.kind === 'gateway-mapped')
      .filter(({ vendors }) => !vendors?.length)
      .map(({ providerId, toolId }) => `${providerId}/${toolId}`)
    expect(unnarrowed).toEqual([])
  })
})
