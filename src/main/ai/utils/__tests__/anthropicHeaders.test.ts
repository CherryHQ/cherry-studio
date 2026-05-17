import { describe, expect, it } from 'vitest'

import { makeAssistant, makeModel, makeProvider } from '../../__tests__/fixtures'
import { addAnthropicHeaders } from '../anthropicHeaders'

const claudeModel = () =>
  makeModel({ id: 'anthropic::claude-sonnet-4-5-20250101', providerId: 'anthropic', name: 'Claude 4.5 Sonnet' })

describe('addAnthropicHeaders', () => {
  it('adds interleaved-thinking beta for Claude 4.5 reasoning + function tool use on direct Anthropic', () => {
    const headers = addAnthropicHeaders(
      makeAssistant({ settings: { toolUseMode: 'function' } }),
      claudeModel(),
      makeProvider({ id: 'anthropic', name: 'Anthropic' })
    )
    expect(headers).toContain('interleaved-thinking-2025-05-14')
  })

  it('skips interleaved-thinking when tool use mode is `prompt`', () => {
    const headers = addAnthropicHeaders(
      makeAssistant({ settings: { toolUseMode: 'prompt' } }),
      claudeModel(),
      makeProvider({ id: 'anthropic', name: 'Anthropic' })
    )
    expect(headers).not.toContain('interleaved-thinking-2025-05-14')
  })

  it('skips interleaved-thinking on Bedrock', () => {
    const headers = addAnthropicHeaders(
      makeAssistant({ settings: { toolUseMode: 'function' } }),
      claudeModel(),
      makeProvider({ id: 'aws-bedrock', presetProviderId: 'aws-bedrock' })
    )
    expect(headers).not.toContain('interleaved-thinking-2025-05-14')
  })

  it('adds web-search beta for Claude 4 series on Vertex when web search is enabled', () => {
    const headers = addAnthropicHeaders(
      makeAssistant({ settings: { enableWebSearch: true } }),
      makeModel({ id: 'anthropic::claude-sonnet-4-20250101', providerId: 'anthropic' }),
      makeProvider({ id: 'google-vertex', presetProviderId: 'google-vertex' })
    )
    expect(headers).toContain('web-search-2025-03-05')
  })

  it('does NOT add web-search on Vertex when web search is disabled', () => {
    const headers = addAnthropicHeaders(
      makeAssistant({ settings: { enableWebSearch: false } }),
      makeModel({ id: 'anthropic::claude-sonnet-4-20250101', providerId: 'anthropic' }),
      makeProvider({ id: 'google-vertex', presetProviderId: 'google-vertex' })
    )
    expect(headers).not.toContain('web-search-2025-03-05')
  })

  it('returns an empty list for non-qualifying model/provider combos', () => {
    const headers = addAnthropicHeaders(makeAssistant(), makeModel(), makeProvider({ id: 'openai' }))
    expect(headers).toEqual([])
  })
})
