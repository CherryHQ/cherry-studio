/**
 * P1 contract for the context-build feature: oversized tool results are
 * persisted + truncated, exempted tools are preserved verbatim, and
 * everything else round-trips losslessly. `transformParams` converts the
 * prompt through context-chef's IR and back on EVERY call, so any field
 * dropped here would be silently dropped in production for every provider.
 * The round-trip assertions are the shipping gate for this feature.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import { application } from '@application'
import { createMiddleware } from '@context-chef/ai-sdk-middleware'
import { FileSystemAdapter } from '@context-chef/core'
import { DEFAULT_CONTEXT_SETTINGS } from '@shared/data/types/contextSettings'
import type { LanguageModelMiddleware } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RequestScope } from '../../scope'
import { buildChefOptions, contextBuildFeature } from '../contextBuild'

const CACHE_MARK = { anthropic: { cacheControl: { type: 'ephemeral' } } }
const BIG = 150_000

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-build-'))
  // Global mock's application.get() throws for unknown services — stub the
  // VfsBlobService surface the feature consumes.
  vi.mocked(application.get).mockImplementation(() => ({ getAdapter: () => new FileSystemAdapter(tmpDir) }) as never)
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

interface ScopeOverrides {
  entries?: Array<{ name: string; truncatable?: boolean }>
  contextSettings?: RequestScope['contextSettings']
  compressionModel?: RequestScope['compressionModel']
  model?: Partial<RequestScope['model']>
}

function makeScope(overrides: ScopeOverrides = {}): RequestScope {
  return {
    registry: { getAll: () => overrides.entries ?? [] },
    model: { id: 'test-model', contextWindow: 200_000, ...overrides.model },
    request: {},
    contextSettings: overrides.contextSettings ?? DEFAULT_CONTEXT_SETTINGS,
    compressionModel: overrides.compressionModel ?? null
  } as never
}

/**
 * Fixture deliberately covers the shapes chef's adapter handles specially:
 * a multimodal file part (mapped through chef's attachments), a multi-call
 * assistant turn, a two-part tool message (split into per-part IR messages
 * and re-merged on the way back), and a `json`-typed tool output (rewritten
 * to text only when truncated — it must survive as `json` under the
 * threshold). A well-formed history must also pass chef's boundary
 * sanitization (`ensureValidHistory`) completely untouched; the round-trip
 * deep-equality pins all of this.
 */
function makePrompt(toolName: string, chars: number): LanguageModelV3Prompt {
  return [
    { role: 'system', content: 'You are helpful.' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'fetch and summarize' },
        { type: 'file', mediaType: 'image/png', data: 'aGVsbG8=', filename: 'screen.png' }
      ]
    },
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'thinking...', providerOptions: { google: { thoughtSignature: 'sig-1' } } },
        { type: 'tool-call', toolCallId: 'c1', toolName, input: { q: 'x' } },
        { type: 'tool-call', toolCallId: 'c2', toolName: 'data__query', input: { sql: 'select 1' } }
      ]
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'c1',
          toolName,
          output: { type: 'text', value: 'x'.repeat(chars) },
          providerOptions: CACHE_MARK
        },
        {
          type: 'tool-result',
          toolCallId: 'c2',
          toolName: 'data__query',
          output: { type: 'json', value: { rows: [1, 2], ok: true } }
        }
      ]
    },
    { role: 'user', content: [{ type: 'text', text: 'now summarize' }], providerOptions: CACHE_MARK }
  ]
}

/**
 * Expected shape after always-on `compact: { reasoning: 'before-last-message' }`
 * runs: the stale reasoning part on the (non-final) assistant message is
 * dropped. Everything else — system content, tool-call inputs, part- and
 * message-level providerOptions, the json tool output — must still round-trip
 * losslessly through chef's fromAISDK/toAISDK adapter. This helper lets the
 * round-trip assertions stay strict on the adapter while accounting for the
 * compaction step the feature now configures.
 */
function compacted(prompt: LanguageModelV3Prompt): LanguageModelV3Prompt {
  return prompt.map((m) =>
    m.role === 'assistant' ? { ...m, content: m.content.filter((p) => p.type !== 'reasoning') } : m
  )
}

async function runTransform(prompt: LanguageModelV3Prompt, scope: RequestScope): Promise<LanguageModelV3Prompt> {
  const middleware = createMiddleware(buildChefOptions(scope)!)
  const result = await middleware.transformParams!({
    params: { prompt } as never,
    type: 'generate',
    model: {} as never
  })
  return result.prompt
}

function toolOutput(prompt: LanguageModelV3Prompt): { value: string; providerOptions?: unknown } {
  const toolMsg = prompt.find((m) => m.role === 'tool') as Extract<LanguageModelV3Prompt[number], { role: 'tool' }>
  const part = toolMsg.content[0] as { output: { value: string }; providerOptions?: unknown }
  return { value: part.output.value, providerOptions: part.providerOptions }
}

describe('buildChefOptions → createMiddleware', () => {
  it('persists oversized tool results and points the marker at the file', async () => {
    const out = await runTransform(makePrompt('mcp__srv__dump', BIG), makeScope())
    const { value } = toolOutput(out)
    const files = fs.readdirSync(tmpDir)
    expect(files).toHaveLength(1)
    expect(value).toContain('<persisted-output>')
    expect(value).toContain(path.join(tmpDir, files[0]))
    expect(value.length).toBeLessThan(10_000)
    expect(fs.readFileSync(path.join(tmpDir, files[0]), 'utf8')).toBe('x'.repeat(BIG))
    // The sibling json result in the same tool message is under threshold —
    // it must survive untouched, still typed `json`.
    const toolMsg = out.find((m) => m.role === 'tool') as Extract<LanguageModelV3Prompt[number], { role: 'tool' }>
    expect(toolMsg.content[1]).toEqual({
      type: 'tool-result',
      toolCallId: 'c2',
      toolName: 'data__query',
      output: { type: 'json', value: { rows: [1, 2], ok: true } }
    })
  })

  it('keeps part-level providerOptions on a truncated tool result', async () => {
    const out = await runTransform(makePrompt('mcp__srv__dump', BIG), makeScope())
    expect(toolOutput(out).providerOptions).toEqual(CACHE_MARK)
  })

  it('preserves tools flagged truncatable: false verbatim (perTool exemption)', async () => {
    const scope = makeScope({ entries: [{ name: 'kb__search', truncatable: false }, { name: 'web__fetch' }] })
    const out = await runTransform(makePrompt('kb__search', BIG), scope)
    expect(toolOutput(out).value).toBe('x'.repeat(BIG))
    expect(fs.readdirSync(tmpDir)).toHaveLength(0)
  })

  it('round-trips a prompt under the threshold losslessly (modulo compacted reasoning)', async () => {
    // Deep equality over the WHOLE prompt: system string content, tool-call
    // input, part-level and message-level providerOptions, the json output.
    // The stale reasoning part is intentionally dropped by the always-on
    // `compact` step (see compacted()); everything else must survive. If the
    // surviving fields differ, the bug is in context-chef's fromAISDK/toAISDK
    // adapter — STOP and fix upstream (@context-chef/ai-sdk-middleware), do
    // not paper over it here.
    const out = await runTransform(makePrompt('web__fetch', 100), makeScope())
    expect(out).toEqual(compacted(makePrompt('web__fetch', 100)))
  })

  it('leaves non-truncated portions of an oversized prompt untouched (modulo compacted reasoning)', async () => {
    const out = await runTransform(makePrompt('mcp__srv__dump', BIG), makeScope())
    const reference = compacted(makePrompt('mcp__srv__dump', BIG))
    expect(out.filter((m) => m.role !== 'tool')).toEqual(reference.filter((m) => m.role !== 'tool'))
  })
})

describe('contextBuildFeature', () => {
  it('is gated on contextSettings.enabled and contributes one middleware-pushing plugin', async () => {
    expect(contextBuildFeature.applies!(makeScope())).toBe(true)
    expect(
      contextBuildFeature.applies!(makeScope({ contextSettings: { ...DEFAULT_CONTEXT_SETTINGS, enabled: false } }))
    ).toBe(false)

    const plugins = contextBuildFeature.contributeModelAdapters!(makeScope())
    expect(plugins).toHaveLength(1)

    const ctx = { middlewares: undefined as LanguageModelMiddleware[] | undefined }
    await (plugins[0] as { configureContext: (c: unknown) => void | Promise<void> }).configureContext(ctx)
    expect(ctx.middlewares).toHaveLength(1)
    expect(typeof ctx.middlewares![0].transformParams).toBe('function')
  })

  it('pushes no middleware when context settings are disabled', async () => {
    const scope = makeScope({ contextSettings: { ...DEFAULT_CONTEXT_SETTINGS, enabled: false } })
    const plugins = contextBuildFeature.contributeModelAdapters!(scope)
    const ctx = { middlewares: undefined as LanguageModelMiddleware[] | undefined }
    await (plugins[0] as { configureContext: (c: unknown) => void | Promise<void> }).configureContext(ctx)
    expect(ctx.middlewares).toBeUndefined()
  })
})

describe('buildChefOptions — compression wiring', () => {
  it('returns null when context settings are disabled', () => {
    const scope = makeScope({ contextSettings: { ...DEFAULT_CONTEXT_SETTINGS, enabled: false } })
    expect(buildChefOptions(scope)).toBeNull()
  })

  it('wires compact + truncate + contextWindow when enabled', () => {
    const scope = makeScope({ contextSettings: DEFAULT_CONTEXT_SETTINGS })
    const opts = buildChefOptions(scope)!
    expect(opts).not.toBeNull()
    expect(opts.compact).toEqual({ reasoning: 'before-last-message', emptyMessages: 'remove' })
    expect(opts.truncate?.threshold).toBe(DEFAULT_CONTEXT_SETTINGS.truncateThreshold)
    expect(typeof opts.contextWindow).toBe('number')
    expect(opts.onBeforeCompress).toBeTypeOf('function')
    expect(opts.logger).toBeDefined()
  })

  it('attaches compress only when enabled AND a model resolved', () => {
    const withModel = makeScope({ contextSettings: DEFAULT_CONTEXT_SETTINGS, compressionModel: {} as never })
    const withModelOpts = buildChefOptions(withModel)!
    expect(withModelOpts.compress).toEqual({ model: {} })
    // Model present → chef LLM-compresses on budget; no sliding-window fallback.
    expect(withModelOpts.onBeforeCompress).toBeUndefined()
    expect(withModelOpts.onCompress).toBeTypeOf('function')

    const noModel = makeScope({ contextSettings: DEFAULT_CONTEXT_SETTINGS, compressionModel: null })
    const noModelOpts = buildChefOptions(noModel)!
    expect(noModelOpts.compress).toBeUndefined()
    // Wanted but unavailable → no-LLM sliding-window guard.
    expect(noModelOpts.onBeforeCompress).toBeTypeOf('function')

    const compressOff = makeScope({
      contextSettings: { ...DEFAULT_CONTEXT_SETTINGS, compress: { enabled: false, modelId: null } },
      compressionModel: {} as never
    })
    expect(buildChefOptions(compressOff)!.compress).toBeUndefined()
  })

  it('attaches NO budget machinery when compression is disabled (no chef Janitor → no warnings)', () => {
    // Regression: setting onCompress/onBeforeCompress unconditionally made chef
    // build a Janitor on every request and warn when no model/tokenizer.
    const scope = makeScope({
      contextSettings: { ...DEFAULT_CONTEXT_SETTINGS, compress: { enabled: false, modelId: null } },
      compressionModel: {} as never
    })
    const opts = buildChefOptions(scope)!
    expect(opts.compress).toBeUndefined()
    expect(opts.onCompress).toBeUndefined()
    expect(opts.onBeforeCompress).toBeUndefined()
    // truncate + compact still active.
    expect(opts.truncate).toBeDefined()
    expect(opts.compact).toBeDefined()
  })
})
