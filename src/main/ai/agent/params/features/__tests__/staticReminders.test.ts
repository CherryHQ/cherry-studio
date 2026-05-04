import type { LanguageModelV3CallOptions, LanguageModelV3Message } from '@ai-sdk/provider'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { collectMock } = vi.hoisted(() => ({ collectMock: vi.fn() }))

vi.mock('../../../../reminders/collectStatic', () => ({
  collectStaticReminders: collectMock
}))

import type { RequestScope } from '../../scope'
import { staticRemindersFeature } from '../staticReminders'

beforeEach(() => {
  collectMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

interface MiddlewareLike {
  transformParams?: (input: { params: LanguageModelV3CallOptions }) => Promise<LanguageModelV3CallOptions>
}

function getMiddleware(workspaceRoot: string | null): MiddlewareLike {
  const plugins = staticRemindersFeature.contributeModelAdapters?.({ workspaceRoot } as RequestScope) ?? []
  expect(plugins).toHaveLength(1)
  const ctx: { middlewares?: MiddlewareLike[] } = {}
  ;(plugins[0] as { configureContext?: (c: typeof ctx) => void }).configureContext?.(ctx)
  expect(ctx.middlewares).toHaveLength(1)
  return ctx.middlewares![0]
}

const userMsg = (text: string): LanguageModelV3Message => ({
  role: 'user',
  content: [{ type: 'text', text }]
})

const assistantMsg = (text: string): LanguageModelV3Message => ({
  role: 'assistant',
  content: [{ type: 'text', text }]
})

const baseParams = (prompt: LanguageModelV3Message[]): LanguageModelV3CallOptions =>
  ({ prompt }) as LanguageModelV3CallOptions

describe('staticRemindersFeature middleware', () => {
  /**
   * No reminders to inject → params returned unchanged. Anchors the
   * fast-path guard so a future refactor doesn't accidentally
   * always-mutate.
   */
  it('returns params unchanged when no reminder blocks are produced', async () => {
    collectMock.mockResolvedValue([])
    const mw = getMiddleware('/repo')
    const params = baseParams([userMsg('hi')])
    const out = await mw.transformParams!({ params })
    expect(out).toBe(params)
  })

  /**
   * Position + wrap contract on LMv3 messages: blocks become a
   * `<system-reminder name="...">…</system-reminder>` block prepended
   * to the text part of the latest user message. Other messages stay
   * intact. This is the LMv3 equivalent of the UIMessage prepending
   * the deleted `tagBlocks` tests covered.
   */
  it('prepends wrapped reminder blocks to the latest user message text', async () => {
    collectMock.mockResolvedValue([{ name: 'agents-md', content: 'project rules' }])
    const mw = getMiddleware('/repo')
    const messages: LanguageModelV3Message[] = [userMsg('first'), assistantMsg('reply'), userMsg('second')]
    const out = await mw.transformParams!({ params: baseParams(messages) })

    const prompt = out.prompt as LanguageModelV3Message[]
    const firstUser = prompt[0]
    const lastUser = prompt[2]
    expect(firstUser.role).toBe('user')
    expect(lastUser.role).toBe('user')
    if (firstUser.role !== 'user' || lastUser.role !== 'user') return

    const firstText = firstUser.content[0]
    const lastText = lastUser.content[0]
    expect(firstText.type === 'text' && firstText.text).toBe('first')
    expect(lastText.type === 'text' && lastText.text.includes('agents-md')).toBe(true)
    expect(lastText.type === 'text' && lastText.text.includes('project rules')).toBe(true)
    expect(lastText.type === 'text' && lastText.text.endsWith('second')).toBe(true)
  })

  /**
   * No user message in the prompt → return params unchanged. Guards
   * against systems-only invocations or odd tool-only continuations
   * where there's nothing to attach a reminder to.
   */
  it('returns params unchanged when there is no user message', async () => {
    collectMock.mockResolvedValue([{ name: 'agents-md', content: 'rules' }])
    const mw = getMiddleware('/repo')
    const params = baseParams([assistantMsg('only assistant')])
    const out = await mw.transformParams!({ params })
    expect(out).toBe(params)
  })

  /**
   * Closure cache contract — `collectStaticReminders` runs once per
   * request, not once per agent step. Two transformParams calls
   * should call the collector exactly once. The cache is the
   * difference between one stat() per request and one stat() per
   * step; small but worth pinning so a future refactor doesn't move
   * the await out of the closure.
   */
  it('caches the reminder fetch across multiple transformParams calls in the same request', async () => {
    collectMock.mockResolvedValue([{ name: 'agents-md', content: 'rules' }])
    const mw = getMiddleware('/repo')
    await mw.transformParams!({ params: baseParams([userMsg('one')]) })
    await mw.transformParams!({ params: baseParams([userMsg('two')]) })
    expect(collectMock).toHaveBeenCalledTimes(1)
  })
})
