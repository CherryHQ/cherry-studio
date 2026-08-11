/**
 * P1 contract for the context-build feature: oversized tool results are
 * persisted + truncated, exempted tools are preserved verbatim, and
 * everything else round-trips losslessly. `transformParams` converts the
 * prompt through the context module's IR and back on EVERY call, so any field
 * dropped here would be silently dropped in production for every provider.
 * The round-trip assertions are the shipping gate for this feature.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { LanguageModelV3Prompt } from '@ai-sdk/provider'
import { createContextMiddleware, type VFSStorageAdapter } from '@cherrystudio/ai-core'
import { MIN_IN_FLIGHT_TRUNCATE_THRESHOLD } from '@main/ai/constants'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { DEFAULT_CONTEXT_SETTINGS } from '@shared/data/types/contextSettings'
import type { LanguageModelMiddleware } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getByIdMock, adapterFactoryMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  adapterFactoryMock: vi.fn()
}))
vi.mock('@data/services/MessageService', () => ({ messageService: { getById: getByIdMock } }))
vi.mock('@main/ai/contextBuild/persistedOutputAdapter', () => ({
  createFileManagerStorageAdapter: adapterFactoryMock
}))

import type { RequestScope } from '../../scope'
import {
  buildContextOptions,
  contextBuildFeature,
  hasAnchorRow,
  resolveInFlightTruncateThreshold
} from '../contextBuild'

const CACHE_MARK = { anthropic: { cacheControl: { type: 'ephemeral' } } }
const BIG = 150_000

let tmpDir: string

/** Stand-in for the FileManager-backed adapter: same interface, tmpdir-backed. */
function tmpDirAdapter(dir: string): VFSStorageAdapter {
  return {
    write: (f, c) => fs.writeFileSync(path.join(dir, f), c, 'utf8'),
    read: (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : null),
    exists: (f) => fs.existsSync(path.join(dir, f)),
    getPhysicalPath: (f) => path.join(dir, f)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-build-'))
  // Anchored by default: the request id resolves to a message row, so the
  // truncate layer gets storage (as in a normal chat turn).
  getByIdMock.mockReturnValue({ id: 'anchor-1' })
  adapterFactoryMock.mockImplementation(() => tmpDirAdapter(tmpDir))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

interface ScopeOverrides {
  entries?: Array<{ name: string; truncatable?: boolean }>
  contextSettings?: RequestScope['contextSettings']
  compressionModel?: RequestScope['compressionModel']
  model?: Partial<RequestScope['model']>
  request?: Partial<RequestScope['request']>
  requestContext?: Partial<RequestScope['requestContext']>
  canOffloadToolOutputs?: boolean
}

function makeScope(overrides: ScopeOverrides = {}): RequestScope {
  return {
    registry: { getAll: () => overrides.entries ?? [] },
    model: { id: 'test-model', contextWindow: 200_000, ...overrides.model },
    request: { ...overrides.request },
    requestContext: { requestId: 'anchor-1', persistedOutputPaths: new Set<string>(), ...overrides.requestContext },
    contextSettings: overrides.contextSettings ?? DEFAULT_CONTEXT_SETTINGS,
    compressionModel: overrides.compressionModel ?? null,
    // The normal chat turn. The anchor lookup happens once upstream, so storage
    // routing reads this flag rather than re-querying the row.
    canOffloadToolOutputs: overrides.canOffloadToolOutputs ?? true
  } as never
}

/**
 * Fixture deliberately covers the shapes the context adapter handles specially:
 * a multimodal file part (mapped through the adapter's attachments), a multi-call
 * assistant turn, a two-part tool message (split into per-part IR messages
 * and re-merged on the way back), and a `json`-typed tool output (rewritten
 * to text only when truncated — it must survive as `json` under the
 * threshold). A well-formed history must also pass the module's boundary
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

async function runTransform(prompt: LanguageModelV3Prompt, scope: RequestScope): Promise<LanguageModelV3Prompt> {
  const middleware = createContextMiddleware(buildContextOptions(scope)!)
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

describe('buildContextOptions → createMiddleware', () => {
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

  it('round-trips a user-ending prompt under the threshold losslessly, including historical reasoning', async () => {
    // Deep equality over the WHOLE prompt: system string content, tool-call
    // input, historical reasoning, part-level and message-level providerOptions,
    // and the json output. If any field differs, the bug is in the context module's fromAISDK/toAISDK
    // adapter — STOP and fix it there (packages/aiCore/src/core/context), do
    // not paper over it here.
    const out = await runTransform(makePrompt('web__fetch', 100), makeScope())
    expect(out).toEqual(makePrompt('web__fetch', 100))
  })

  it('round-trips a tool-ending prompt under the threshold losslessly, including assistant reasoning', async () => {
    const prompt = makePrompt('web__fetch', 100).slice(0, -1)
    const out = await runTransform(prompt, makeScope())
    expect(out).toEqual(prompt)
  })

  it('leaves non-truncated portions of an oversized prompt untouched, including reasoning', async () => {
    const out = await runTransform(makePrompt('mcp__srv__dump', BIG), makeScope())
    const reference = makePrompt('mcp__srv__dump', BIG)
    expect(out.filter((m) => m.role !== 'tool')).toEqual(reference.filter((m) => m.role !== 'tool'))
  })
})

describe('buildContextOptions — perTool lane rules', () => {
  const fakeCodec = { deflate: () => null, assemble: (s: unknown) => s, snippet: (t: string) => t }

  it('truncatable:false → bare-string preserve, even when a codec exists (fs_read invariant)', () => {
    const scope = makeScope({
      entries: [
        { name: 'fs_read', truncatable: false, codec: fakeCodec } as never,
        { name: 'plain_exempt', truncatable: false }
      ]
    })
    const opts = buildContextOptions(scope)!
    expect(opts.truncate?.perTool).toEqual(['fs_read', 'plain_exempt'])
  })

  it('codec-bearing entries become perTool objects carrying the codec closure', () => {
    const scope = makeScope({ entries: [{ name: 'web_fetch', codec: fakeCodec } as never, { name: 'other' }] })
    const opts = buildContextOptions(scope)!
    expect(opts.truncate?.perTool).toEqual([{ name: 'web_fetch', codec: fakeCodec }])
  })
})

describe('buildContextOptions — storage routing', () => {
  it('anchored request → FileManager adapter wired with the placeholder id and allow-list set', () => {
    const persistedOutputPaths = new Set<string>()
    const scope = makeScope({ requestContext: { requestId: 'anchor-1', persistedOutputPaths } })
    const opts = buildContextOptions(scope)!
    expect(opts.truncate?.storage).toBeDefined()
    expect(adapterFactoryMock).toHaveBeenCalledWith({ messageId: 'anchor-1', persistedOutputPaths })
  })

  it('no message row (temp chat / one-shot streamPrompt) → no storage', () => {
    const opts = buildContextOptions(makeScope({ canOffloadToolOutputs: false }))!
    expect(opts.truncate?.storage).toBeUndefined()
    expect(adapterFactoryMock).not.toHaveBeenCalled()
    // The row was resolved upstream; storage routing must not query it again.
    expect(getByIdMock).not.toHaveBeenCalled()
  })

  it('non-anchored oversized results still truncate inline (no files, no marker path)', async () => {
    const out = await runTransform(makePrompt('mcp__srv__dump', BIG), makeScope({ canOffloadToolOutputs: false }))
    const { value } = toolOutput(out)
    expect(value.length).toBeLessThan(10_000)
    expect(value).toContain('--- truncated')
    expect(value).not.toContain('<persisted-output>')
    expect(fs.readdirSync(tmpDir)).toHaveLength(0)
  })
})

// The lookup moved out of resolveTruncateStorage so it can gate fs_read's
// admission too, and now runs once per request in buildAgentParams.
describe('hasAnchorRow', () => {
  it('reports an anchored request when the id resolves to a message row', () => {
    expect(hasAnchorRow('anchor-1')).toBe(true)
    expect(getByIdMock).toHaveBeenCalledWith('anchor-1')
  })

  it('treats a missing row as non-anchored (temp chat / one-shot streamPrompt)', () => {
    // Real MessageService.getById throws NOT_FOUND for missing rows — it never returns null.
    getByIdMock.mockImplementation(() => {
      throw DataApiErrorFactory.notFound('Message', 'anchor-1')
    })
    expect(hasAnchorRow('anchor-1')).toBe(false)
  })

  it('skips the lookup entirely when the request carries no message id', () => {
    expect(hasAnchorRow(undefined)).toBe(false)
    expect(getByIdMock).not.toHaveBeenCalled()
  })

  it('rethrows anything that is not a missing row', () => {
    getByIdMock.mockImplementation(() => {
      throw new Error('db is on fire')
    })
    expect(() => hasAnchorRow('anchor-1')).toThrow('db is on fire')
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

  it('does not register context middleware for caller-owned requests', async () => {
    const scope = makeScope({ request: { contextOwner: 'caller' } })
    expect(contextBuildFeature.applies!(scope)).toBe(false)
    expect(buildContextOptions(scope)).toBeNull()

    const plugins = contextBuildFeature.contributeModelAdapters!(scope)
    const ctx = { middlewares: undefined as LanguageModelMiddleware[] | undefined }
    await (plugins[0] as { configureContext: (c: unknown) => void | Promise<void> }).configureContext(ctx)
    expect(ctx.middlewares).toBeUndefined()
    expect(getByIdMock).not.toHaveBeenCalled()
    expect(adapterFactoryMock).not.toHaveBeenCalled()
  })
})

// The persist lane keeps a plain character threshold (it guards DB size and
// reload cost, which don't depend on the window). The in-flight lane guards the
// window itself, so the same character count means wildly different things per
// model — the 100k default is ~3% of a 1M window but several times a 16k one,
// where it never fired and one tool result could swamp the request.
describe('resolveInFlightTruncateThreshold', () => {
  it('uses the window share when it is below the configured character setting', () => {
    // 16k window → 16000 * 0.1 * 3 = 4800 chars, far below the 100k setting
    expect(resolveInFlightTruncateThreshold(100_000, 16_000)).toBe(4800)
  })

  it('keeps the configured setting when the window share is larger', () => {
    // 1M window share would be 300k; the explicit setting still caps the top
    expect(resolveInFlightTruncateThreshold(30_000, 1_000_000)).toBe(30_000)
  })

  it('never trims below the head+tail the truncator keeps anyway', () => {
    expect(resolveInFlightTruncateThreshold(100_000, 1000)).toBe(MIN_IN_FLIGHT_TRUNCATE_THRESHOLD)
  })

  it('scales with the window (the point of the change)', () => {
    const small = resolveInFlightTruncateThreshold(100_000, 16_000)
    const large = resolveInFlightTruncateThreshold(100_000, 200_000)
    expect(small).toBeLessThan(large)
  })

  // `Model.contextWindow` is `z.number().optional()` — custom / v1-imported /
  // CherryAI rows really do arrive without it. Multiplying `undefined` yields
  // `NaN`, and the truncator's `text.length <= NaN` is false for EVERY result,
  // so ordinary tool output would be offloaded as if oversized.
  it.each([[undefined], [0], [Number.NaN], [-1], [Number.POSITIVE_INFINITY]])(
    'falls back to the character setting for an unusable window (%s)',
    (window) => {
      const threshold = resolveInFlightTruncateThreshold(100_000, window)
      expect(threshold).toBe(100_000)
      expect(Number.isFinite(threshold)).toBe(true)
    }
  )
})

describe('buildContextOptions — models without a contextWindow', () => {
  it('omits contextWindow and keeps the character threshold instead of emitting NaN', () => {
    const scope = makeScope({ model: { contextWindow: undefined } })
    const opts = buildContextOptions(scope)!
    expect(opts.contextWindow).toBeUndefined()
    expect(opts.truncate?.threshold).toBe(DEFAULT_CONTEXT_SETTINGS.truncateThreshold)
    expect(Number.isNaN(opts.truncate?.threshold)).toBe(false)
  })

  it('does not treat an ordinary tool result as oversized', async () => {
    // 3k chars: far under the 100k setting, but > head+tail — the NaN threshold
    // used to offload exactly this.
    const out = await runTransform(
      makePrompt('mcp__srv__dump', 3_000),
      makeScope({ model: { contextWindow: undefined } })
    )
    expect(toolOutput(out).value).not.toContain('<persisted-output>')
    expect(fs.readdirSync(tmpDir)).toHaveLength(0)
  })
})

describe('buildContextOptions — compression wiring', () => {
  it('returns null when context settings are disabled', () => {
    const scope = makeScope({ contextSettings: { ...DEFAULT_CONTEXT_SETTINGS, enabled: false } })
    expect(buildContextOptions(scope)).toBeNull()
  })

  it('wires compact + truncate + contextWindow when enabled', () => {
    const scope = makeScope({ contextSettings: DEFAULT_CONTEXT_SETTINGS })
    const opts = buildContextOptions(scope)!
    expect(opts).not.toBeNull()
    expect(opts.compact).toEqual({ reasoning: 'none', emptyMessages: 'remove' })
    // In-flight threshold is window-relative: min(setting, window share).
    expect(opts.truncate?.threshold).toBe(
      resolveInFlightTruncateThreshold(DEFAULT_CONTEXT_SETTINGS.truncateThreshold, 200_000)
    )
    expect(typeof opts.contextWindow).toBe('number')
    expect(opts.onBeforeCompress).toBeTypeOf('function')
    expect(opts.logger).toBeDefined()
  })

  it('durable+mid-loop owns LLM compress: only the no-model fallback wires a budget hook', () => {
    // In-flight LLM compression no longer exists as an option — the trimmed
    // ContextMiddlewareOptions type makes it unrepresentable. What remains to
    // pin is the onBeforeCompress wiring per compression state.
    // compress.enabled + model present: durable path owns it — the middleware gets NO Janitor.
    const withModel = makeScope({ contextSettings: DEFAULT_CONTEXT_SETTINGS, compressionModel: {} as never })
    const withModelOpts = buildContextOptions(withModel)!
    // Model present → durable path handles it; no sliding-window fallback needed.
    expect(withModelOpts.onBeforeCompress).toBeUndefined()

    // compress.enabled + no model: no-LLM sliding-window fallback still active.
    const noModel = makeScope({ contextSettings: DEFAULT_CONTEXT_SETTINGS, compressionModel: null })
    const noModelOpts = buildContextOptions(noModel)!
    // Wanted but unavailable → no-LLM sliding-window guard.
    expect(noModelOpts.onBeforeCompress).toBeTypeOf('function')

    // compress.enabled: false → nothing set regardless of model.
    const compressOff = makeScope({
      contextSettings: { ...DEFAULT_CONTEXT_SETTINGS, compress: { enabled: false, modelId: null } },
      compressionModel: {} as never
    })
    expect(buildContextOptions(compressOff)!.onBeforeCompress).toBeUndefined()
  })

  // The Janitor re-estimates after this hook and returns early once under
  // budget, so it will NOT re-run `ensureValidHistory` — whatever the fallback
  // returns goes to the provider as-is. Dropping a single message could cut
  // between `assistant(tool_call)` and its `tool` results and leave an orphan,
  // which strict providers reject.
  describe('sliding-window fallback is turn-atomic', () => {
    const fallback = () => {
      const scope = makeScope({ contextSettings: DEFAULT_CONTEXT_SETTINGS, compressionModel: null })
      return buildContextOptions(scope)!.onBeforeCompress!
    }

    /** system, then 4 tool-using turns (assistant tool_call + 2 tool results each). */
    const toolHistory = () => {
      const h: Array<Record<string, unknown>> = [{ role: 'system', content: 'sys' }]
      for (let t = 0; t < 4; t++) {
        h.push({ role: 'user', content: `ask ${t}` })
        h.push({
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: `c${t}a`, type: 'function', function: { name: 'f', arguments: '{}' } },
            { id: `c${t}b`, type: 'function', function: { name: 'f', arguments: '{}' } }
          ]
        })
        h.push({ role: 'tool', content: 'r'.repeat(400), tool_call_id: `c${t}a` })
        h.push({ role: 'tool', content: 'r'.repeat(400), tool_call_id: `c${t}b` })
      }
      return h as never
    }

    it('never leaves an orphan tool result at the head', () => {
      const history = toolHistory()
      // Force a drop whose proportional boundary lands inside a tool turn.
      const kept = fallback()(history, { currentTokens: 1000, limit: 550 } as never) as Array<{ role: string }>
      expect(kept.length).toBeLessThan((history as unknown as unknown[]).length)
      const firstNonSystem = kept.find((m) => m.role !== 'system')
      expect(firstNonSystem?.role).not.toBe('tool')
    })

    it('never keeps an assistant tool-call whose results were dropped', () => {
      const history = toolHistory()
      const kept = fallback()(history, { currentTokens: 1000, limit: 550 } as never) as Array<{
        role: string
        tool_calls?: Array<{ id: string }>
        tool_call_id?: string
      }>
      const resultIds = new Set(kept.filter((m) => m.role === 'tool').map((m) => m.tool_call_id))
      for (const m of kept) {
        for (const call of m.tool_calls ?? []) {
          expect(resultIds.has(call.id)).toBe(true)
        }
      }
    })

    it('leaves history untouched when already under budget', () => {
      const history = toolHistory()
      expect(fallback()(history, { currentTokens: 100, limit: 1000 } as never)).toBe(history)
    })
  })

  it('attaches NO budget machinery when compression is disabled (no Janitor → no warnings)', () => {
    // Regression: setting onCompress/onBeforeCompress unconditionally made the middleware
    // build a Janitor on every request and warn when no model/tokenizer.
    const scope = makeScope({
      contextSettings: { ...DEFAULT_CONTEXT_SETTINGS, compress: { enabled: false, modelId: null } },
      compressionModel: {} as never
    })
    const opts = buildContextOptions(scope)!
    expect(opts.onBeforeCompress).toBeUndefined()
    // truncate + compact still active.
    expect(opts.truncate).toBeDefined()
    expect(opts.compact).toBeDefined()
  })
})
