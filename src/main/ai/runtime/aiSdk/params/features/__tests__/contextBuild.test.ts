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

function makeScope(entries: Array<{ name: string; truncatable?: boolean }> = []): RequestScope {
  return { registry: { getAll: () => entries } } as never
}

function makePrompt(toolName: string, chars: number): LanguageModelV3Prompt {
  return [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: [{ type: 'text', text: 'fetch and summarize' }] },
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'thinking...', providerOptions: { google: { thoughtSignature: 'sig-1' } } },
        { type: 'tool-call', toolCallId: 'c1', toolName, input: { q: 'x' } }
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
        }
      ]
    },
    { role: 'user', content: [{ type: 'text', text: 'now summarize' }], providerOptions: CACHE_MARK }
  ]
}

async function runTransform(prompt: LanguageModelV3Prompt, scope: RequestScope): Promise<LanguageModelV3Prompt> {
  const middleware = createMiddleware(buildChefOptions(scope))
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
  })

  it('keeps part-level providerOptions on a truncated tool result', async () => {
    const out = await runTransform(makePrompt('mcp__srv__dump', BIG), makeScope())
    expect(toolOutput(out).providerOptions).toEqual(CACHE_MARK)
  })

  it('preserves tools flagged truncatable: false verbatim (perTool exemption)', async () => {
    const scope = makeScope([{ name: 'kb__search', truncatable: false }, { name: 'web__fetch' }])
    const out = await runTransform(makePrompt('kb__search', BIG), scope)
    expect(toolOutput(out).value).toBe('x'.repeat(BIG))
    expect(fs.readdirSync(tmpDir)).toHaveLength(0)
  })

  it('round-trips a prompt under the threshold losslessly', async () => {
    // Deep equality over the WHOLE prompt: system string content, assistant
    // reasoning with provider thoughtSignature, tool-call input, part-level
    // and message-level providerOptions. If this fails, the bug is in
    // context-chef's fromAISDK/toAISDK adapter — STOP and fix upstream
    // (@context-chef/ai-sdk-middleware), do not paper over it here.
    const out = await runTransform(makePrompt('web__fetch', 100), makeScope())
    expect(out).toEqual(makePrompt('web__fetch', 100))
  })

  it('leaves non-truncated portions of an oversized prompt untouched', async () => {
    const out = await runTransform(makePrompt('mcp__srv__dump', BIG), makeScope())
    const reference = makePrompt('mcp__srv__dump', BIG)
    expect(out.filter((m) => m.role !== 'tool')).toEqual(reference.filter((m) => m.role !== 'tool'))
  })
})

describe('contextBuildFeature', () => {
  it('is always active and contributes one middleware-pushing plugin', async () => {
    expect(contextBuildFeature.applies).toBeUndefined()
    const plugins = contextBuildFeature.contributeModelAdapters!(makeScope())
    expect(plugins).toHaveLength(1)

    const ctx = { middlewares: undefined as LanguageModelMiddleware[] | undefined }
    await (plugins[0] as { configureContext: (c: unknown) => void | Promise<void> }).configureContext(ctx)
    expect(ctx.middlewares).toHaveLength(1)
    expect(typeof ctx.middlewares![0].transformParams).toBe('function')
  })
})
