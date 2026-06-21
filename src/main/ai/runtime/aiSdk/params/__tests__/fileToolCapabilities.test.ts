import { describe, expect, it } from 'vitest'

import { makeModel } from '../../../../__tests__/fixtures/model'
import { makeProvider } from '../../../../__tests__/fixtures/provider'
import { resolveFileToolCapabilities } from '../fileToolCapabilities'

describe('resolveFileToolCapabilities', () => {
  it('accepts media for an OpenAI Responses LLM model', () => {
    const caps = resolveFileToolCapabilities(
      makeProvider({ id: 'openai' }),
      makeModel({ id: 'openai::gpt-4o', apiModelId: 'gpt-4o', name: 'gpt-4o' }),
      'openai'
    )
    expect(caps.acceptsMediaInToolResult).toBe(true)
    expect(typeof caps.isVision).toBe('boolean')
  })

  it('accepts media for an Anthropic model', () => {
    const caps = resolveFileToolCapabilities(
      makeProvider({ id: 'anthropic' }),
      makeModel({ id: 'anthropic::claude', apiModelId: 'claude-3-5-sonnet-20241022', name: 'claude-3-5-sonnet' }),
      'anthropic'
    )
    expect(caps.acceptsMediaInToolResult).toBe(true)
  })

  it('rejects media for openai-compatible aggregators (text-only tool results)', () => {
    const caps = resolveFileToolCapabilities(
      makeProvider({ id: 'somehub' }),
      makeModel({ id: 'somehub::gpt-4o', apiModelId: 'gpt-4o', name: 'gpt-4o' }),
      'openai-compatible'
    )
    expect(caps.acceptsMediaInToolResult).toBe(false)
  })

  it('forces text for providers known to break on native files (qiniu)', () => {
    const caps = resolveFileToolCapabilities(
      makeProvider({ id: 'qiniu' }),
      makeModel({ id: 'qiniu::gpt-4o', apiModelId: 'gpt-4o', name: 'gpt-4o' }),
      'openai'
    )
    expect(caps.acceptsMediaInToolResult).toBe(false)
  })
})
